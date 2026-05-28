/**
 * CDK Custom Resource handler that creates a vector index in an
 * OpenSearch Serverless collection before the Bedrock Knowledge Base
 * tries to use it.
 *
 * Called by the CDK Provider framework (not AwsCustomResource) because
 * index creation is an AOSS data-plane HTTP call, not an AWS SDK call.
 */
import * as https from "https";
import { createHmac, createHash } from "crypto";

const REGION = process.env.AWS_REGION!;

// ─── Minimal SigV4 ────────────────────────────────────────────────────────

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function signingKey(secretKey: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac("AWS4" + secretKey, date), region), service), "aws4_request");
}

function signedHeaders(method: string, hostname: string, path: string, body: string): Record<string, string> {
  const accessKey = process.env.AWS_ACCESS_KEY_ID!;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const service = "aoss";

  const now = new Date();
  const amzdate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const datestamp = amzdate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const hasToken = !!sessionToken;
  const canonicalHeadersStr = [
    `content-type:application/json`,
    `host:${hostname}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzdate}`,
    ...(hasToken ? [`x-amz-security-token:${sessionToken}`] : []),
  ].join("\n") + "\n";

  const signedHeaderNames = [
    "content-type",
    "host",
    "x-amz-content-sha256",
    "x-amz-date",
    ...(hasToken ? ["x-amz-security-token"] : []),
  ].join(";");

  const canonicalRequest = [
    method,
    path.startsWith("/") ? path : "/" + path,
    "",
    canonicalHeadersStr,
    signedHeaderNames,
    payloadHash,
  ].join("\n");

  const credentialScope = `${datestamp}/${REGION}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const sig = createHmac("sha256", signingKey(secretKey, datestamp, REGION, service)).update(stringToSign).digest("hex");

  return {
    "Content-Type": "application/json",
    "x-amz-date": amzdate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${sig}`,
    ...(hasToken ? { "x-amz-security-token": sessionToken } : {}),
  };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────

function request(method: string, url: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── CloudFormation response ──────────────────────────────────────────────

function cfnRespond(
  event: Record<string, string>,
  status: "SUCCESS" | "FAILED",
  physicalId: string,
  reason = ""
): Promise<void> {
  const body = JSON.stringify({
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  });
  return new Promise((resolve, reject) => {
    const u = new URL(event.ResponseURL);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: "PUT",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      () => resolve()
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────

export const handler = async (event: Record<string, string>): Promise<void> => {
  console.log("Event:", JSON.stringify(event));

  const physicalId = event.PhysicalResourceId ?? `aoss-index-${Date.now()}`;

  if (event.RequestType === "Delete") {
    // Leave the index in place — deleting the collection removes it anyway.
    await cfnRespond(event, "SUCCESS", physicalId);
    return;
  }

  const endpoint = (process.env.COLLECTION_ENDPOINT ?? "").replace(/\/$/, "");
  const indexName = process.env.INDEX_NAME ?? "neon-scratch-lore-index";
  const dimension = parseInt(process.env.EMBEDDING_DIMENSION ?? "1536", 10);
  const hostname = new URL(endpoint).hostname;
  const indexUrl = `${endpoint}/${indexName}`;

  const indexBody = JSON.stringify({
    settings: {
      index: {
        knn: true,
        "knn.algo_param.ef_search": 512,
      },
    },
    mappings: {
      properties: {
        embedding: {
          type: "knn_vector",
          dimension,
          method: {
            name: "hnsw",
            engine: "faiss",
            parameters: { ef_construction: 512, m: 16 },
          },
        },
        text: { type: "text" },
        metadata: { type: "text" },
      },
    },
  });

  let lastError = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const headers = signedHeaders("PUT", hostname, `/${indexName}`, indexBody);
      const res = await request("PUT", indexUrl, headers, indexBody);
      console.log(`Attempt ${attempt}: HTTP ${res.status} — ${res.body}`);

      if (
        res.status === 200 ||
        res.status === 201 ||
        res.body.includes("resource_already_exists_exception")
      ) {
        await cfnRespond(event, "SUCCESS", `${indexName}-index`);
        return;
      }

      lastError = `HTTP ${res.status}: ${res.body}`;
    } catch (e) {
      lastError = String(e);
      console.error(`Attempt ${attempt} threw:`, e);
    }

    if (attempt < 6) {
      const wait = attempt * 10_000; // 10s, 20s, 30s … back-off
      console.log(`Waiting ${wait}ms before retry…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  console.error("All attempts failed:", lastError);
  await cfnRespond(event, "FAILED", physicalId, lastError.slice(0, 512));
};

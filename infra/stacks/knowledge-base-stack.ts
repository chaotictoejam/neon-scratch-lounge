import * as cdk from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "path";

/**
 * Two modes, controlled by cdk.json context `neonScratch.useBedrockKnowledgeBase`:
 *
 *   false (default) — lore is 16 KB of bundled JSON scored in-memory.
 *                     No OpenSearch Serverless, no idle cost.
 *
 *   true            — full AOSS vector store + Bedrock Knowledge Base.
 *                     Costs ~$701/month idle but enables semantic vector search.
 *                     Requires `amazon.titan-embed-text-v1` model access.
 */
export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("neonScratch") ?? {};
    const useBedrockKnowledgeBase: boolean = config.useBedrockKnowledgeBase ?? false;

    if (!useBedrockKnowledgeBase) {
      this.knowledgeBaseId = "";
      this.knowledgeBaseArn = "";
      new cdk.CfnOutput(this, "LoreStrategy", {
        value: "bundled-json",
        description: "Lore retrieval — JSON bundled into Lambda, no AOSS required. Set useBedrockKnowledgeBase=true to enable AOSS.",
      });
      return;
    }

    // ── AOSS + Bedrock Knowledge Base mode ──────────────────────────────────

    const embeddingModelArn: string = config.embeddingModelArn
      ?? "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1";
    const account = this.account;
    const region = this.region;

    // S3 bucket — lore documents for KB ingestion
    const loreBucket = new s3.Bucket(this, "LoreBucket", {
      bucketName: `neon-scratch-lore-${account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    new s3deploy.BucketDeployment(this, "LoreDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../lore"))],
      destinationBucket: loreBucket,
      destinationKeyPrefix: "lore/",
    });

    // AOSS encryption policy (required before collection can be created)
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, "AossEncryptionPolicy", {
      name: "neon-scratch-encryption",
      type: "encryption",
      policy: JSON.stringify({
        Rules: [{ ResourceType: "collection", Resource: ["collection/neon-scratch-lore"] }],
        AWSOwnedKey: true,
      }),
    });

    // AOSS network policy — public access is fine for a demo
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, "AossNetworkPolicy", {
      name: "neon-scratch-network",
      type: "network",
      policy: JSON.stringify([{
        Rules: [
          { ResourceType: "collection", Resource: ["collection/neon-scratch-lore"] },
          { ResourceType: "dashboard", Resource: ["collection/neon-scratch-lore"] },
        ],
        AllowFromPublic: true,
      }]),
    });

    const collection = new opensearchserverless.CfnCollection(this, "LoreCollection", {
      name: "neon-scratch-lore",
      type: "VECTORSEARCH",
      description: "Neon Scratch Lounge lore vector store",
    });
    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);

    // IAM role assumed by the Bedrock Knowledge Base service
    const kbRole = new iam.Role(this, "KnowledgeBaseRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": account },
          ArnLike: { "aws:SourceArn": `arn:aws:bedrock:${region}:${account}:knowledge-base/*` },
        },
      }),
      inlinePolicies: {
        BedrockKbPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel"],
              resources: [embeddingModelArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["aoss:APIAccessAll"],
              resources: [`arn:aws:aoss:${region}:${account}:collection/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:ListBucket", "s3:GetObject"],
              resources: [loreBucket.bucketArn, `${loreBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // Custom resource Lambda — creates the vector index via AOSS data plane (SigV4 HTTP)
    const createIndexFn = new lambdaNodejs.NodejsFunction(this, "CreateAossIndex", {
      functionName: "neon-scratch-create-aoss-index",
      entry: path.join(__dirname, "../../lambda/custom-resources/create-aoss-index.ts"),
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.minutes(5),
      bundling: { externalModules: [], minify: false, sourceMap: true, forceDockerBundling: false },
      environment: {
        COLLECTION_ENDPOINT: collection.attrCollectionEndpoint,
        INDEX_NAME: "neon-scratch-lore-index",
        EMBEDDING_DIMENSION: "1536",
      },
    });
    createIndexFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["aoss:APIAccessAll"],
      resources: [`arn:aws:aoss:${region}:${account}:collection/*`],
    }));

    // Single data access policy granting both KB role and custom resource Lambda
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, "AossDataAccessPolicy", {
      name: "neon-scratch-data-access",
      type: "data",
      policy: JSON.stringify([{
        Rules: [
          {
            ResourceType: "index",
            Resource: ["index/neon-scratch-lore/*"],
            Permission: [
              "aoss:CreateIndex", "aoss:DeleteIndex", "aoss:UpdateIndex",
              "aoss:DescribeIndex", "aoss:ReadDocument", "aoss:WriteDocument",
            ],
          },
          {
            ResourceType: "collection",
            Resource: ["collection/neon-scratch-lore"],
            Permission: ["aoss:CreateCollectionItems", "aoss:DescribeCollectionItems"],
          },
        ],
        Principal: [kbRole.roleArn, createIndexFn.role!.roleArn],
      }]),
    });

    // Provider framework wrapping the custom resource Lambda
    const indexProvider = new cr.Provider(this, "IndexProvider", {
      onEventHandler: createIndexFn,
      logGroup: new logs.LogGroup(this, "IndexProviderLogs", {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const indexResource = new cdk.CustomResource(this, "AossIndex", {
      serviceToken: indexProvider.serviceToken,
    });
    indexResource.node.addDependency(collection);
    indexResource.node.addDependency(dataAccessPolicy);

    // Bedrock Knowledge Base (L1) — depends on index existing first
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, "LoreKnowledgeBase", {
      name: "neon-scratch-lore",
      description: "Neo-Pawsburg lore — locations, enemies, items, character classes",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: { embeddingModelArn },
      },
      storageConfiguration: {
        type: "OPENSEARCH_SERVERLESS",
        opensearchServerlessConfiguration: {
          collectionArn: collection.attrArn,
          vectorIndexName: "neon-scratch-lore-index",
          fieldMapping: {
            vectorField: "embedding",
            textField: "text",
            metadataField: "metadata",
          },
        },
      },
    });
    knowledgeBase.node.addDependency(indexResource.node.defaultChild as cdk.CfnResource);

    // S3 data source
    const dataSource = new bedrock.CfnDataSource(this, "LoreDataSource", {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: "neon-scratch-lore-s3",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: loreBucket.bucketArn,
          inclusionPrefixes: ["lore/"],
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: { maxTokens: 512, overlapPercentage: 20 },
        },
      },
    });

    // Trigger ingestion job after data source is ready (AwsCustomResource uses SDK v2 internally)
    new cr.AwsCustomResource(this, "TriggerIngestion", {
      onCreate: {
        service: "BedrockAgent",
        action: "startIngestionJob",
        parameters: {
          knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
          dataSourceId: dataSource.attrDataSourceId,
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse("ingestionJob.ingestionJobId"),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:StartIngestionJob"],
          resources: [knowledgeBase.attrKnowledgeBaseArn],
        }),
      ]),
    });

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;

    new cdk.CfnOutput(this, "LoreStrategy", {
      value: "bedrock-knowledge-base",
      description: "Lore retrieval — Bedrock Knowledge Base with AOSS vector store",
    });
    new cdk.CfnOutput(this, "KnowledgeBaseId", { value: this.knowledgeBaseId });
    new cdk.CfnOutput(this, "LoreBucketName", { value: loreBucket.bucketName });
  }
}

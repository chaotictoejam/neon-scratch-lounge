import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import { Construct } from "constructs";
import * as path from "path";

export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly loreBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("neonScratch") ?? {};
    const embeddingModelArn: string =
      config.embeddingModelArn ??
      `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`;

    // S3 bucket for lore documents
    this.loreBucket = new s3.Bucket(this, "LoreVault", {
      bucketName: `neon-scratch-lore-vault-${this.account}`,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Upload lore files as CDK BucketDeployment assets
    new s3deploy.BucketDeployment(this, "LoreData", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../lore"))],
      destinationBucket: this.loreBucket,
      destinationKeyPrefix: "lore/",
    });

    // OpenSearch Serverless collection for vector storage
    const collectionName = "neon-scratch-vectors";

    // Encryption policy
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, "VectorEncryptionPolicy", {
      name: "neon-scratch-enc",
      type: "encryption",
      policy: JSON.stringify({
        Rules: [{ ResourceType: "collection", Resource: [`collection/${collectionName}`] }],
        AWSOwnedKey: true,
      }),
    });

    // Network policy — allow public access from Bedrock service
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, "VectorNetworkPolicy", {
      name: "neon-scratch-net",
      type: "network",
      policy: JSON.stringify([
        {
          Rules: [
            { ResourceType: "collection", Resource: [`collection/${collectionName}`] },
            { ResourceType: "dashboard", Resource: [`collection/${collectionName}`] },
          ],
          AllowFromPublic: true,
        },
      ]),
    });

    // OpenSearch Serverless collection
    const vectorCollection = new opensearchserverless.CfnCollection(this, "VectorCollection", {
      name: collectionName,
      type: "VECTORSEARCH",
      description: "Vector store for Neon Scratch Lounge lore embeddings",
    });
    vectorCollection.addDependency(encryptionPolicy);
    vectorCollection.addDependency(networkPolicy);

    // IAM role for Bedrock Knowledge Base
    const knowledgeBaseRole = new iam.Role(this, "KnowledgeBaseRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:ListBucket"],
              resources: [this.loreBucket.bucketArn, `${this.loreBucket.bucketArn}/*`],
            }),
          ],
        }),
        BedrockEmbedding: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel"],
              resources: [embeddingModelArn],
            }),
          ],
        }),
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["aoss:APIAccessAll"],
              resources: [
                `arn:aws:aoss:${this.region}:${this.account}:collection/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Data access policy for OpenSearch Serverless — allow Bedrock KB role
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, "VectorDataAccessPolicy", {
      name: "neon-scratch-access",
      type: "data",
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: "index",
              Resource: [`index/${collectionName}/*`],
              Permission: [
                "aoss:CreateIndex",
                "aoss:DeleteIndex",
                "aoss:UpdateIndex",
                "aoss:DescribeIndex",
                "aoss:ReadDocument",
                "aoss:WriteDocument",
              ],
            },
            {
              ResourceType: "collection",
              Resource: [`collection/${collectionName}`],
              Permission: ["aoss:CreateCollectionItems"],
            },
          ],
          Principal: [knowledgeBaseRole.roleArn],
        },
      ]),
    });
    dataAccessPolicy.addDependency(vectorCollection);

    // Bedrock Knowledge Base (L1 construct — L2 is in alpha)
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, "NeonScratchKB", {
      name: "neon-scratch-lore",
      description: "Lore vault for The Neon Scratch Lounge cyberpunk cat RPG",
      roleArn: knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
        },
      },
      storageConfiguration: {
        type: "OPENSEARCH_SERVERLESS",
        opensearchServerlessConfiguration: {
          collectionArn: vectorCollection.attrArn,
          vectorIndexName: "neon-scratch-lore-index",
          fieldMapping: {
            vectorField: "embedding",
            textField: "text",
            metadataField: "metadata",
          },
        },
      },
    });
    knowledgeBase.addDependency(vectorCollection);
    knowledgeBase.node.addDependency(dataAccessPolicy);

    // S3 data source pointing at lore bucket
    const dataSource = new bedrock.CfnDataSource(this, "LoreDataSource", {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: "lore-vault-s3",
      description: "S3 lore documents for the Neon Scratch Lounge",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: this.loreBucket.bucketArn,
          inclusionPrefixes: ["lore/"],
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: {
            maxTokens: 300,
            overlapPercentage: 20,
          },
        },
      },
    });

    // Custom resource to trigger ingestion job after deployment
    const ingestionRole = new iam.Role(this, "IngestionTriggerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
      inlinePolicies: {
        BedrockIngestion: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:StartIngestionJob",
                "bedrock:GetIngestionJob",
                "bedrock:ListIngestionJobs",
              ],
              resources: [`arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`],
            }),
          ],
        }),
      },
    });

    new cr.AwsCustomResource(this, "StartIngestion", {
      onCreate: {
        service: "BedrockAgent",
        action: "startIngestionJob",
        parameters: {
          knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
          dataSourceId: dataSource.attrDataSourceId,
        },
        physicalResourceId: cr.PhysicalResourceId.of("ingestion-job"),
      },
      role: ingestionRole,
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;

    new cdk.CfnOutput(this, "KnowledgeBaseId", { value: this.knowledgeBaseId });
    new cdk.CfnOutput(this, "KnowledgeBaseArn", { value: this.knowledgeBaseArn });
    new cdk.CfnOutput(this, "LoreBucketName", { value: this.loreBucket.bucketName });
    new cdk.CfnOutput(this, "OpenSearchCollectionArn", { value: vectorCollection.attrArn });
  }
}

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  Table,
  AttributeType,
  BillingMode,
  TableEncryption,
  StreamViewType,
  TableClass,
} from "aws-cdk-lib/aws-dynamodb";
import { RemovalPolicy } from "aws-cdk-lib";
import { config } from "dotenv";
import { ApiKeySourceType, UsagePlan } from "aws-cdk-lib/aws-apigateway";

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    config();

    const table = new Table(this, "getter-observer-table", {
      partitionKey: {
        name: "pk",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: TableEncryption.AWS_MANAGED,
      stream: StreamViewType.KEYS_ONLY,
    });

    const getterRole = new iam.Role(this, "getter-function-role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    table.grantReadWriteData(getterRole);

    const versionOneGetter = new NodejsFunction(this, "version-one-getter", {
      role: getterRole,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_16_X,
      description:
        "The V1 getter which is the worker behind the V1 API Gateway",
      environment: {
        LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
        TABLE_NAME: table.tableName,
      },
    });

    const versionTwoGetter = new NodejsFunction(this, "version-two-getter", {
      role: getterRole,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_16_X,
      description:
        "The V2 getter which is the worker behind the V2 API Gateway",
      environment: {
        LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
        TABLE_NAME: table.tableName,
      },
    });

    const apiV1 = new apigateway.LambdaRestApi(this, "getter-v1-api", {
      handler: versionOneGetter,
      restApiName: "Getter V1 API",
      proxy: false,
      apiKeySourceType: ApiKeySourceType.HEADER,
    });

    const apiV2 = new apigateway.LambdaRestApi(this, "getter-v2-api", {
      handler: versionTwoGetter,
      restApiName: "Getter V2 API",
      proxy: false,
    });

    const workerRole = new iam.Role(this, "worker-function-role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    const worker = new NodejsFunction(this, "worker", {
      role: workerRole,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_16_X,
      description:
        "The worker which will use flags to determine which API to use in the DataSourceSwitcher",
      environment: {
        LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
        VERSION_1_API_URL: apiV1.url,
        VERSION_2_API_URL: apiV2.url,
        API_KEY: process.env.API_KEY || "",
      },
    });

    const versionOneItems = apiV1.root.addResource("items");
    const getVersionOneItems = versionOneItems.addMethod(
      "GET",
      new apigateway.LambdaIntegration(versionOneGetter),
      {
        apiKeyRequired: true,
      }
    ); // GET /items

    const versionTwoItems = apiV2.root.addResource("items");
    const getVersionTwoItems = versionTwoItems.addMethod(
      "GET",
      new apigateway.LambdaIntegration(versionTwoGetter),
      {
        apiKeyRequired: true,
      }
    ); // GET /items

    const apiKey = new apigateway.ApiKey(this, "worker-api-key", {
      value: process.env.API_KEY || "",
      resources: [apiV1, apiV2],
    });
    apiKey.grantRead(workerRole);

    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        effect: iam.Effect.ALLOW,
        resources: [getVersionOneItems.methodArn],
      })
    );

    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        effect: iam.Effect.ALLOW,
        resources: [getVersionTwoItems.methodArn],
      })
    );

    const plan = new UsagePlan(this, "default-usage-plan", {
      apiStages: [
        {
          api: apiV1,
          stage: apiV1.deploymentStage,
        },
        {
          api: apiV2,
          stage: apiV2.deploymentStage,
        },
      ],
      description: "default usage plan for items APIs",
    });
    plan.addApiKey(apiKey);
  }
}

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
} from "aws-cdk-lib/aws-dynamodb";
import { RemovalPolicy } from "aws-cdk-lib";
import { config } from "dotenv";
import { ApiKeySourceType, UsagePlan } from "aws-cdk-lib/aws-apigateway";
import { WebSocketApi, WebSocketStage } from "@aws-cdk/aws-apigatewayv2-alpha";
import { WebSocketLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, properties?: cdk.StackProps) {
    super(scope, id, properties);

    config();

    const table = new Table(this, "getter-observer-table", {
      partitionKey: {
        name: "pk",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: TableEncryption.AWS_MANAGED,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });

    const streamHandler = new NodejsFunction(this, "stream-handler", {
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

    streamHandler.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 5,
        bisectBatchOnError: true,
        retryAttempts: 10,
      })
    );

    table.grantReadWriteData(streamHandler);

    const versionOneGetter = new NodejsFunction(this, "version-one-getter", {
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

    table.grantReadWriteData(versionOneGetter);

    const versionTwoGetter = new NodejsFunction(this, "version-two-getter", {
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

    table.grantReadWriteData(versionOneGetter);

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

    const worker = new NodejsFunction(this, "worker", {
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
    apiKey.grantRead(worker);

    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        effect: iam.Effect.ALLOW,
        resources: [getVersionOneItems.methodArn],
      })
    );

    worker.addToRolePolicy(
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

    const connectHandler = new NodejsFunction(this, "connect-handler", {
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: "./lib/connect-handler/index.ts",
      description: "The connect handler for the web socket API",
      environment: {
        LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
        TABLE_NAME: table.tableName,
      },
    });

    const disconnectHandler = new NodejsFunction(this, "disconnect-handler", {
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_16_X,
      description: "The disconnect handler for the web socket API",
      environment: {
        LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
        TABLE_NAME: table.tableName,
      },
    });

    const publishCallsUpdater = new NodejsFunction(
      this,
      "publish-calls-handler",
      {
        memorySize: 2048,
        timeout: cdk.Duration.seconds(10),
        runtime: lambda.Runtime.NODEJS_16_X,
        description: "The connect handler for the web socket API",
        environment: {
          LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
          TABLE_NAME: table.tableName,
        },
      }
    );

    table.grantReadWriteData(connectHandler);
    table.grantReadWriteData(disconnectHandler);
    table.grantReadData(publishCallsUpdater);

    const webSocketApi = new WebSocketApi(this, "web-sockets-api", {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "ConnectIntegration",
          connectHandler
        ),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "DisconnectIntegration",
          disconnectHandler
        ),
      },
    });

    webSocketApi.addRoute("publishCalls", {
      integration: new WebSocketLambdaIntegration(
        "publish-calls",
        publishCallsUpdater
      ),
    });

    const apiStage = new WebSocketStage(this, "web-sockets-stage", {
      webSocketApi,
      stageName: "dev",
      autoDeploy: true,
    });

    const connectionsArns = this.formatArn({
      service: "execute-api",
      resourceName: `${apiStage.stageName}/POST/*`,
      resource: webSocketApi.apiId,
    });

    publishCallsUpdater.addToRolePolicy(
      new PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [connectionsArns],
      })
    );
  }
}

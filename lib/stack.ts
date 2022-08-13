import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Table, AttributeType, BillingMode, TableEncryption, StreamViewType, TableClass } from "aws-cdk-lib/aws-dynamodb";
import { RemovalPolicy } from "aws-cdk-lib";

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
      functionName: "data-source-switcher-worker",
    });

    const table = new Table(this, 'getter-observer-table', {
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: 'data-source-switcher-observer',
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: TableEncryption.AWS_MANAGED,
      stream: StreamViewType.KEYS_ONLY,
    });

    const getterRole = new iam.Role(this, "worker-function-role", {
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
      functionName: "data-source-switcher-V1-getter",
    });

    const versionTwoGetter = new NodejsFunction(this, "version-two-getter", {
      role: getterRole,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_16_X,
      description:
        "The V2 getter which is the worker behind the V2 API Gateway",
      functionName: "data-source-switcher-V2-getter",
    });

    const apiV1 = new apigateway.LambdaRestApi(this, 'getter-v1-api', {
      handler: versionOneGetter,
      restApiName: 'Getter V1 API'
    });

    const apiV2 = new apigateway.LambdaRestApi(this, 'getter-v2-api', {
      handler: versionTwoGetter,
      restApiName: 'Getter V2 API',
    });

    const versionOneItems = apiV1.root.addResource('items');
    const versionTwoItems = apiV2.root.addResource('items');
    versionOneItems.addMethod('GET');  // GET /items
    versionTwoItems.addMethod('GET');  // GET /items

    const versionOneItem = versionOneItems.addResource('{item}');
    const versionTwoItem = versionTwoItems.addResource('{item}');
    versionOneItem.addMethod('GET');   // GET /items/{item}
    versionTwoItem.addMethod('GET');   // GET /items/{item}
  }
}

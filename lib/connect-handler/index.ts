import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent } from "aws-lambda";
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const handler = async (event: APIGatewayProxyEvent) => {
  let statusCode = 200;
  const body: any = {};
  try {
    await client.waitForInitialization();
    body.initialization = "success";

    await documentClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME || "",
        Key: {
          pk: `connection-${event.requestContext.connectionId}`,
        },
        UpdateExpression:
          "SET active = :status, connectionId = :connectionId, connectTime = :connectTime",
        ExpressionAttributeValues: {
          ":status": true,
          ":connectionId": event.requestContext.connectionId,
          ":connectTime": event.requestContext.connectedAt,
        },
      })
    );
  } catch (error) {
    console.error("error", error);
    statusCode = 500;
    body.initialization = "failure";
  }
  return {
    statusCode,
    body: JSON.stringify(body),
  };
};

export { handler };

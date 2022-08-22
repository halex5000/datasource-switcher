import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const handler = async (event: any) => {
  let statusCode = 200;
  try {
    await client.waitForInitialization();

    await documentClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME || "",
        Key: {
          pk: `connections`,
          sk: 1,
        },
        UpdateExpression: "ADD ids :id",
        ExpressionAttributeValues: {
          ":id": new Set([event.requestContext.connectionId]),
        },
        ReturnValues: "ALL_NEW",
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

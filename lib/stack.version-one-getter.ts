import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

type GetterEvent = {};

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const handler = async (event: GetterEvent) => {
  let statusCode = 200;
  const body: any = {};
  try {
    await client.waitForInitialization();
    body.initialization = "success";

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME || "",
        Key: {
          pk: "v1-calls",
          sk: 'total'
        },
        UpdateExpression: "SET calls = calls + :num",
        ExpressionAttributeValues: {
          ":num": 1,
        },
      })
    );
  } catch (err) {
    console.error("error", err);
    statusCode = 500;
    body.initialization = "failure";
  }
  return JSON.stringify({
    statusCode,
    body,
  });
};

export { handler };

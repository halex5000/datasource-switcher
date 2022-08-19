import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
const config = { region: process.env.AWS_REGION };
const dynamoClient = new DynamoDBClient(config);
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const handler = async (event: any) => {
  let statusCode = 200;
  const body: any = {};
  try {
    await client.waitForInitialization();
    body.initialization = "success";

    const results = await documentClient.send(
      new QueryCommand({
        TableName: process.env.TABLE_NAME || "",
        KeyConditionExpression: "pk = connections",
        FilterExpression: "contains (active, :status)",
        ExpressionAttributeValues: {
          ":status": { BOOL: true },
        },
        ProjectionExpression: "connectionList",
      })
    );

    const deleteCommands: any[] = [];
    const postCommands: any[] = [];

    if (results.Items)
      for (const item of results.Items) {
        const { connectionList } = unmarshall(item) as {
          connectionList: string[];
        };
        console.log(connectionList);

        for (const connection of connectionList) {
          postCommands.push(
            new PostToConnectionCommand({
              ConnectionId: connection,
              Data: JSON.parse(event.body).data,
            })
          );
        }
      }

    if (postCommands)
      for (const command of postCommands) {
        console.log(command);
      }

    if (deleteCommands)
      for (const command of deleteCommands) {
        console.log(command);
      }

    return { statusCode: 200, body: "Data sent." };
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

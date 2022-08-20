import { init } from "launchdarkly-node-server-sdk";
import {
  AttributeValue,
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  PostToConnectionCommand,
  ApiGatewayManagementApiClient,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBStreamEvent } from "aws-lambda";
const config = { region: process.env.AWS_REGION };
const dynamoClient = new DynamoDBClient(config);
const apiClient = new ApiGatewayManagementApiClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.WEBSOCKET_URL,
});
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const handler = async (event: DynamoDBStreamEvent) => {
  let statusCode = 200;
  const body: any = {};
  try {
    const { Records: records } = event;

    if (records && records.length > 0) {
      for (const record of records.filter(
        (record) => record.eventName !== "REMOVE"
      )) {
        const newImage = record.dynamodb?.NewImage;

        if (newImage) {
          await client.waitForInitialization();
          body.initialization = "success";

          const {
            sk,
            pk,
            v1CallCount: versionOneCallCount,
            v2CallCount: versionTwoCallCount,
          } = unmarshall(newImage as Record<string, AttributeValue>) as {
            v1CallCount: number;
            v2CallCount: number;
            pk: "aggregate-count";
            sk: number;
          };

          if (pk === "aggregate-count") {
            // get the connected ids
            const results = await documentClient.send(
              new GetItemCommand({
                TableName: process.env.TABLE_NAME || "",
                Key: {
                  pk: {
                    S: "connections",
                  },
                },
                ProjectionExpression: "ids",
              })
            );

            const postCommands: PostToConnectionCommand[] = [];

            if (results.Item) {
              const { ids } = unmarshall(results.Item) as {
                ids: Set<string>;
              };

              for (const id of ids) {
                console.log(id);

                postCommands.push(
                  new PostToConnectionCommand({
                    ConnectionId: id,
                    Data: Buffer.from(
                      JSON.stringify({
                        time: sk,
                        versionOneCallCount,
                        versionTwoCallCount,
                      })
                    ),
                  })
                );
              }

              if (postCommands) {
                const commands = postCommands.map((command) =>
                  apiClient.send(command)
                );
                await Promise.all(commands);
              }
            }
          }
        }
      }
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

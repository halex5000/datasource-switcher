import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBStreamEvent } from "aws-lambda";
import { AttributeValue, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const handler = async (event: DynamoDBStreamEvent) => {
  const statusCode = 200;
  const body: any = {};

  try {
    await client.waitForInitialization();
    body.initialization = "success";

    const { Records: records } = event;

    if (records && records.length > 0) {
      let versionOneCallCount = 0;
      let versionTwoCallCount = 0;

      for (const record of records.filter(
        (record) => record.eventName !== "REMOVE"
      )) {
        const newImage = record.dynamodb?.NewImage;
        if (newImage) {
          const { callCount, pk } = unmarshall(
            newImage as Record<string, AttributeValue>
          ) as {
            callCount: number;
            pk: "v1-calls" | "v2-calls";
          };

          if (callCount) {
            if (pk === "v1-calls") {
              versionOneCallCount += callCount;
            }
            if (pk === "v2-calls") {
              versionTwoCallCount += callCount;
            }
          }
        }
      }

      if (versionOneCallCount || versionTwoCallCount) {
        // add to the set of call counts in the table
        // with a sort key for the time stamp to allow for sorting
        // results by time
        // that way, on connect, we can backfill the timeline
        const result = await documentClient.send(
          new UpdateCommand({
            TableName: process.env.TABLE_NAME || "",
            Key: {
              pk: `aggregate-count`,
              sk: Date.now(),
            },
            UpdateExpression: `SET v1CallCount = :v1CallCount, v2CallCount = :v2CallCount`,
            ExpressionAttributeValues: {
              ":v1CallCount": versionOneCallCount,
              ":v2CallCount": versionTwoCallCount,
            },
            ReturnValues: "ALL_NEW",
          })
        );
        console.log("update results:", result.Attributes);
      }
    }
  } catch (error: any) {
    console.error("error encountered", error);
  }
  return {
    statusCode,
    body: JSON.stringify(body),
  };
};

export { handler };

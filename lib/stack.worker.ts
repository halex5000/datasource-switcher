import { init } from "launchdarkly-node-server-sdk";
import axios from "axios";
import { nanoid } from "nanoid";

type DataSourceConfig = {
  apiVersion: string;
  versionTwoEnabled: boolean;
};

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const apiVersionOneUrl = process.env.VERSION_1_API_URL || "";
const apiVersionTwoUrl = process.env.VERSION_2_API_URL || "";

const defaultConfig: DataSourceConfig = {
  apiVersion: "1.0",
  versionTwoEnabled: false,
};

const users = [
  "alex",
  "munnawar",
  "jess",
  "heidi",
  "cody",
  "ieva",
  "mads",
  "alea",
  "peter",
  "ravi",
];

function randomIntFromInterval(min: number, max: number) {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

const handler = async (event: any) => {
  let apiVersion = defaultConfig.apiVersion;
  let versionTwoEnabled = defaultConfig.versionTwoEnabled;
  try {
    const client = init(clientId);
    await client.waitForInitialization();
    const randomInt = randomIntFromInterval(1, 10);

    const userId = randomInt === 5 ? users[0] : nanoid();

    const dataSourceConfig: DataSourceConfig = await client.variation(
      "data-source-controller",
      {
        key: userId,
      },
      defaultConfig
    );

    apiVersion = dataSourceConfig.apiVersion;
    versionTwoEnabled = dataSourceConfig.versionTwoEnabled;

    const baseURL = dataSourceConfig.versionTwoEnabled
      ? apiVersionTwoUrl
      : apiVersionOneUrl;

    const { data, status } = await axios({
      baseURL,
      url: `/items?userId=${userId}`,
      headers: {
        "x-api-key": process.env.API_KEY || "",
      },
      method: "GET",
    });

    console.log("response", {
      data,
      status,
    });
  } catch (error: any) {
    console.error("error", error);
  }
  return {
    apiVersion,
    versionTwoEnabled,
  };
};

export { handler };

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
];

const handler = async (event: any) => {
  let apiVersion = defaultConfig.apiVersion;
  let versionTwoEnabled = defaultConfig.versionTwoEnabled;
  try {
    const client = init(clientId);
    await client.waitForInitialization();
    const random = Math.floor(Math.random() * users.length);
    console.log(random, users[random]);
    const user = users[random];
    const dataSourceConfig: DataSourceConfig = await client.variation(
      "data-source-controller",
      {
        key: nanoid(),
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
      url: `/items?userId=${user}`,
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

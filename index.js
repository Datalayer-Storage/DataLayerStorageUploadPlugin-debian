const superagent = require("superagent");
const fs = require("fs");
const express = require("express");
const bodyParser = require("body-parser");
const { getChiaRoot } = require("./utils");
const chiaRoot = getChiaRoot();
const path = require("path");
const https = require("https");
const { getConfig } = require("./config-loader");
const { logger } = require("./logger.js");

const app = express();
const CONFIG = getConfig();

app.use(bodyParser.json());

const generateSourceFilePath = (chiaRoot, file) => {
  return path.join(
    chiaRoot,
    "data_layer",
    "db",
    "server_files_location_mainnet",
    file
  );
};

const getPresignedUrl = async (storeId, filename, retry = 0) => {
  const username = CONFIG.CLIENT_ACCESS_KEY;
  const password = CONFIG.CLIENT_SECRET_ACCESS_KEY;

  try {
    const response = await superagent
      .post("https://api.datalayer.storage/file/v1/upload")
      .auth(username, password)
      .send({ store_id: storeId, filename })
      .timeout(300000);

    return response.body;
  } catch (error) {
    if (retry < 5) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return getPresignedUrl(storeId, filename, retry + 1);
    } else {
      const errorMessage =
        error.response?.body?.message || "No message provided";
      logger.error(
        `Error getting presigned URL or uploading file: ${filename}. Error: ${errorMessage}`
      );
      throw new Error("Error getting presigned URL");
    }
  }
};

const uploadFileToS3 = async (storeId, filename, retry = 0) => {
  if (retry < 5) {
    try {
      const { presignedPost, isDuplicate, error } = await getPresignedUrl(
        storeId,
        filename
      );

      if (isDuplicate) {
        logger.info(`File already exists: ${filename}`);
        return;
      }

      if (!isDuplicate && !error) {
        const filePath = generateSourceFilePath(chiaRoot, filename);

        const file = fs.createReadStream(filePath);

        const uploadResponse = await superagent
          .post(presignedPost.url)
          .field(presignedPost.fields)
          .attach("file", file, filename);

        logger.info(`File successfully uploaded: ${filename}`);
        return uploadResponse;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return uploadFileToS3(storeId, filename, retry + 1);
    }
  } else {
    logger.error(`Error Uploading file after 5 attempts: ${filename}`);
  }
};


const initiateAddMissingFilesOnLocal = async () => {
  try {
    const chiaRoot = getChiaRoot();
    const certFile = path.resolve(
      `${chiaRoot}/config/ssl/data_layer/private_data_layer.crt`
    );
    const keyFile = path.resolve(
      `${chiaRoot}/config/ssl/data_layer/private_data_layer.key`
    );

    const response = await superagent
      .post(
        `https://${CONFIG.RPC_HOST}:${CONFIG.RPC_DATALAYER_PORT}/add_missing_files`
      )
      .send({})
      .set("Content-Type", "application/json")
      .key(fs.readFileSync(keyFile))
      .cert(fs.readFileSync(certFile))
      .agent(
        new https.Agent({
          rejectUnauthorized: false,
        })
      );

    console.log(response.body);

    return response.body;
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      logger.error(
        `Connection refused. Please make sure the local datalayer is running on port: ${CONFIG.RPC_DATALAYER_PORT}. Trying again in 5 min`
      );
      await new Promise((resolve) => setTimeout(resolve, 300000));
    } else {
      logger.error("Error:", error.message);
    }
  }
};

app.post("/add_missing_files", async (req, res) => {
  logger.info("add missing files request received");
  try {
    const { store_id, files } = req.body;

    for (let file of JSON.parse(files)) {
      if (!file.includes("full")) {
        await uploadFileToS3(store_id, file);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    res.status(200).json({ uploaded: true });
  } catch (error) {
    console.error(error);

    res.status(500).json({ uploaded: false });
  }
});

app.post("/handle_upload", async (req, res) => {
  res.status(200).json({ handle_upload: true });
});

app.post("/plugin_info", (req, res) => {
  logger.info("plugin info request received");
  try {
    const info = {
      name: "S3 Plugin For Datalayer Storage",
      version: "1.0.0",
      description:
        "A plugin to handle upload, for files to the Datalayer Storage System",
    };

    res.status(200).json(info);
  } catch (err) {
    console.error(`Error retrieving plugin info: ${err.message}`);
    res.status(500).json({ error: "Failed to retrieve plugin information" });
  }
});

app.post("/upload", async (req, res) => {
  logger.info("upload request received");
  const { store_id, full_tree_filename, diff_filename } = req.body;

  try {
    await Promise.all([
      // Dont upload the full files for now
      // uploadFileToS3(store_id, full_tree_filename),
      uploadFileToS3(store_id, diff_filename),
    ]);

    res.status(200).json({ uploaded: true });
  } catch (error) {
    console.error("can not upload file", error);
    res.status(400).json({ uploaded: false });
  }
});

const port = CONFIG.PORT || 41410;

if (!CONFIG.CLIENT_ACCESS_KEY || !CONFIG.CLIENT_SECRET_ACCESS_KEY) {
  console.error(
    "Missing CLIENT_ACCESS_KEY or CLIENT_SECRET_ACCESS_KEY Please update ~/.dlaas/config.yaml with a access key generated from https://datalayer.storage. The steps are as follows: \n1) Create an account. \n2) Aquire an active subscription. \n3) Generate a new Access Key and Secret with the app at https://datalayer.storage. \n4) copy the access key and secret into ~/.dlaas/config.yaml"
  );
} else {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    initiateAddMissingFilesOnLocal();
  });
}

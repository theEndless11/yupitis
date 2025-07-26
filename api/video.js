import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import util from "util";

// --- R2 Testing Credentials (DO NOT USE IN PROD) ---
const CLOUDFLARE_ACCOUNT_ID = "a0d2ee4c3b97b4d55ffa7c09579cc684";
const R2_ACCESS_KEY_ID = "8783d62b4010c7362d96be2c5fb0d4b4";
const R2_SECRET_ACCESS_KEY = "cc47e7963c400346d8c417fc101ab699cd615d5fdefe85c53def4432988c3be4";
const R2_BUCKET_NAME = "shorts-app";
const R2_ENDPOINT = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// --- R2 Client Setup ---
const S3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// --- CORS Headers for localhost:5172 and browsers ---
const setCorsHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5172");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
};

// --- Multer Config for Video Upload ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed."));
    }
  },
});

const multerMiddleware = util.promisify(upload.single("video"));

// --- Upload Handler ---
export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    await multerMiddleware(req, res);

    if (!req.file) {
      return res.status(400).json({ message: "No video file uploaded." });
    }

    const {
      caption = "Untitled Short",
      userId = "anonymous",
      username = "Anonymous User",
    } = req.body;

    const timestamp = Date.now();
    const safeCaption = caption.replace(/[^a-zA-Z0-9._-\s]/g, "_").substring(0, 50);
    const fileKey = `videos/shorts/${userId}/${timestamp}-${safeCaption}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: {
        caption,
        userId,
        username,
        uploadedAt: new Date().toISOString(),
        type: "shorts",
      },
    });

    await S3.send(command);

    return res.status(200).json({
      message: "Video uploaded successfully!",
      key: fileKey,
    });
  } catch (error) {
    console.error("Upload error:", error);
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 500;
    return res.status(status).json({
      message: error.code === "LIMIT_FILE_SIZE" ? "File is too large." : "Failed to upload video.",
      error: error.message,
    });
  }
}

// Disable default body parsing for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

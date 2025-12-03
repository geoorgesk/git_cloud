import { Octokit } from "@octokit/rest";
import multer from "multer";
import nextConnect from "next-connect";

const upload = multer();

export const config = {
  api: {
    bodyParser: false, // Important for multer
  },
};

const apiRoute = nextConnect();

// multer middleware: field name 'photo'
apiRoute.use(upload.single("photo"));

apiRoute.post(async (req, res) => {
  try {
    // Basic env validation
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_USER = process.env.GITHUB_USER;
    const MAX_REPO_SIZE_BYTES = Number(process.env.MAX_REPO_SIZE_BYTES || "0");

    if (!GITHUB_TOKEN || !GITHUB_USER) {
      return res.status(500).json({ error: "Missing GitHub credentials on server." });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file uploaded. Form field must be 'photo'." });
    }

    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    // get the latest repo that starts with photo-store
    const getLatestRepo = async () => {
      const repos = await octokit.repos.listForAuthenticatedUser({
        sort: "created",
        direction: "desc",
        per_page: 10, // only need a few recent repos
      });
      return repos.data.find((r) => r.name.startsWith("photo-store"));
    };

    const createNewRepo = async () => {
      const repoName = `photo-store-${Date.now()}`;
      await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        private: true,
      });
      return repoName;
    };

    const getValidRepo = async () => {
      const repo = await getLatestRepo();
      if (!repo) return await createNewRepo();

      // repo.size is in KB (GitHub API), convert to bytes
      const sizeBytes = repo.size * 1024;
      if (MAX_REPO_SIZE_BYTES > 0 && sizeBytes >= MAX_REPO_SIZE_BYTES) {
        return await createNewRepo();
      }
      return repo.name;
    };

    const repoName = await getValidRepo();
    const fileName = `img_${Date.now()}.jpg`;
    const base64 = req.file.buffer.toString("base64");

    // Create or update file contents (new file name ensures no sha required)
    const createResult = await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_USER,
      repo: repoName,
      path: fileName,
      message: "Uploaded image",
      content: base64,
    });

    // Determine default branch for correct raw URL
    let defaultBranch = "main";
    try {
      const { data: repoInfo } = await octokit.repos.get({
        owner: GITHUB_USER,
        repo: repoName,
      });
      if (repoInfo?.default_branch) defaultBranch = repoInfo.default_branch;
    } catch (e) {
      // not fatal — keep defaultBranch as 'main' if lookup fails
      console.warn("Could not determine default branch, using 'main' fallback.", e?.message || e);
    }

    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${repoName}/${defaultBranch}/${fileName}`;

    res.status(200).json({
      success: true,
      repo: repoName,
      file: fileName,
      url: rawUrl,
      commit: createResult.data?.commit?.sha ?? null,
    });
  } catch (error) {
    // Better error logging for Octokit errors
    console.error("Upload error:", {
      message: error.message,
      status: error.status,
      data: error.response?.data,
      stack: error.stack,
    });
    res.status(500).json({ error: "Upload failed", details: error.message });
  }
});

export default apiRoute;

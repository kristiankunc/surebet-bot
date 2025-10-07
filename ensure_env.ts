import fs from "fs/promises";

export async function ensureEnv() {
	const exampleEnv = await fs.readFile(".env.example", "utf-8");
	const requiredVars = exampleEnv
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const parts = line.split("=");
			return (parts[0] || "").trim().replace(/"/g, "");
		});

	const missingVars = requiredVars.filter((varName) => !(varName in process.env));
	if (missingVars.length > 0) {
		throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
	}
}

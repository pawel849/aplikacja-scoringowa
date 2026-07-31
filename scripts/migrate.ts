import { readFile, readdir } from "node:fs/promises";
import { getClient } from "../src/db/client";
async function main() {
  const db = getClient();
  const directory = new URL("../drizzle/", import.meta.url), files = (await readdir(directory)).filter((x) => /^\d+.*\.sql$/.test(x)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    if (db.exec) await db.exec(sql); else {
      const statements = sql.split(/;\s*\n(?=(?:CREATE|INSERT|DO|ALTER)\b)/i).map((x) => x.trim()).filter(Boolean);
      for (const statement of statements) await db.query(statement.endsWith(";") ? statement : `${statement};`);
    }
    console.log(`Migracja ${file} zakończona.`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

import express from "express";
import cors from "cors";
import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const SPREADSHEET_ID = process.env.SHEET_ID;
const CREDENTIALS_PATH = "./credentials.json"; // You must add this file.

async function getSheetsService() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

app.post("/api/apply-leave", async (req, res) => {
  try {
    const { name, email, leaveType, startDate, endDate, reason } = req.body;
    if (!name || !email || !leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "All fields are required." });
    }
    const sheets = await getSheetsService();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[name, email, leaveType, startDate, endDate, reason, "Pending"]],
      },
    });
    res.json({ success: true, message: "Leave application submitted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit leave application." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

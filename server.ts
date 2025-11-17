import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const forACureEmail = process.env.EMAIL_USER
const forACurePassword = process.env.EMAIL_PASS

console.log("Email user:", forACureEmail);
console.log("Email pass:", forACurePassword ? "loaded" : "missing");

const resend = new Resend(process.env.RESEND_API_KEY);


// POST /contact route
app.post("/contact", async (req, res) => {
  const {email: senderEmail, message } = req.body;

  if ( !senderEmail || !message) {
    return res.status(400).json({ error: "Missing fields" });
  }

    try {
    const response = await resend.emails.send({
      from: "For A Cure <onboarding@resend.dev>",
      to: process.env.EMAIL_USER ?? "",
      subject: `New Contact Form Message from ${senderEmail}`,
      text: `
New message from: ${senderEmail}

Message:
${message}
      `,
    });

    res.json({ success: true, id: response.data?.id });
  } catch (error) {
    console.error("Resend error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const forACureEmail = process.env.EMAIL_USER
const forACurePassword = process.env.EMAIL_PASS

console.log("Email user:", forACureEmail);
console.log("Email pass:", forACurePassword ? "loaded" : "missing");



// POST /contact route
app.post("/contact", async (req, res) => {
  const {email: senderEmail, message } = req.body;

  if ( !senderEmail || !message) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: forACureEmail,
        pass: forACurePassword,
      },
    });

    const mailOptions = {
      from: forACureEmail,
      to: forACureEmail,
      subject: `New Contact Form Message from ${senderEmail}`,
      text: `
This was the message sent from ${senderEmail}:
${message}
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Email error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
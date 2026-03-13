// app/api/groq/route.js  (Next.js App Router)
// Place this file at:  src/app/api/groq/route.js
//                  or  app/api/groq/route.js
//
// The GROQ_API_KEY env var is server-only (no NEXT_PUBLIC_ prefix).
// Set it in Vercel dashboard → Settings → Environment Variables.
// For localhost create .env.local with:  GROQ_API_KEY=gsk_xxx

import { NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function POST(request) {
  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey) {
    return NextResponse.json(
      { error: { message: "GROQ_API_KEY is not configured on the server." } },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body." } },
      { status: 400 }
    );
  }

  // Forward the request to Groq
  const groqRes = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await groqRes.json();

  if (!groqRes.ok) {
    return NextResponse.json(data, { status: groqRes.status });
  }

  return NextResponse.json(data);
}
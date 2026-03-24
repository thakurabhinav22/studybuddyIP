'use server';

import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { z } from 'zod';

const mcqSchema = z.object({
  mcqs: z.array(
    z.object({
      question: z.string().min(5),
      options: z.array(z.string()).length(4),
      correctAnswer: z.number().int().min(0).max(3),
      explanation: z.string().optional(),
    })
  ).min(4).max(12),   // Flexible range
});

export async function generateMCQs(subjectId, moduleId, department, semester) {
  const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY_MCQS,
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/3 - Generating MCQs for ${moduleId}`);

      const { text: rawText } = await generateText({
        model: groq('llama-3.1-8b-instant'),
        prompt: `You are a strict JSON generator. Output **ONLY** valid JSON, nothing else.

Subject: ${subjectId}
Module: ${moduleId}

Content:
"""
${/* We will pass content from client if needed, but for now keep prompt simple */ ''}
"""

Generate 8 MCQs and return them in this exact format:

{
  "mcqs": [
    {
      "question": "Full question text goes here?",
      "options": ["A. Option one", "B. Option two", "C. Option three", "D. Option four"],
      "correctAnswer": 0,
      "explanation": "Short explanation why this is correct"
    }
  ]
}

Start directly with { and end with }. No markdown, no extra text.`,
        temperature: 0.6,
        maxTokens: 1400,
      });

      // Aggressive cleaning
      let cleaned = rawText.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];

      console.log(`Raw response preview (attempt ${attempt}):`, cleaned.substring(0, 500));

      const parsed = JSON.parse(cleaned);
      const result = mcqSchema.safeParse(parsed);

      if (result.success && result.data.mcqs.length >= 4) {
        console.log(`✅ Success! Generated ${result.data.mcqs.length} MCQs on attempt ${attempt}`);
        return result.data.mcqs;
      }

      console.log(`Attempt ${attempt} returned invalid format, retrying...`);
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt === 3) throw new Error(`Failed after 3 attempts. Last error: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 800 * attempt));
    }
  }

  throw new Error("Failed to generate MCQs after multiple attempts");
}
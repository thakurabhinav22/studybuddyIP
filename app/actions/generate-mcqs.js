'use server';

import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { z } from 'zod';

const LEVELS = ["Remember", "Understand", "Analyze"];

function normalizeLevel(level, fallback = "Understand") {
  const raw = (level || "").toString().trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes("remember")) return "Remember";
  if (raw.includes("understand") || raw.includes("compreh")) return "Understand";
  if (raw.includes("analy")) return "Analyze";
  return fallback;
}

function buildLevelTargets(totalQuestions = 30, weakByLevel = {}) {
  const total = Math.max(3, Number(totalQuestions) || 30);
  const weights = LEVELS.map((lvl) => Math.max(1, Number(weakByLevel?.[lvl]) || 0));
  const sum = weights.reduce((a, b) => a + b, 0) || 3;

  const counts = {
    Remember: Math.floor((weights[0] / sum) * total),
    Understand: Math.floor((weights[1] / sum) * total),
    Analyze: Math.floor((weights[2] / sum) * total),
  };

  let assigned = counts.Remember + counts.Understand + counts.Analyze;
  const ordered = [...LEVELS].sort((a, b) => (weakByLevel?.[b] || 0) - (weakByLevel?.[a] || 0));
  let idx = 0;
  while (assigned < total) {
    const level = ordered[idx % ordered.length];
    counts[level] += 1;
    assigned += 1;
    idx += 1;
  }

  return counts;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function enforceExactCountWithLevels(items, totalQuestions, levelTargets) {
  const bucket = { Remember: [], Understand: [], Analyze: [] };
  items.forEach((item) => {
    const level = normalizeLevel(item?.level);
    bucket[level].push(item);
  });

  const picked = [];
  LEVELS.forEach((level) => {
    const need = Math.max(0, Number(levelTargets?.[level]) || 0);
    picked.push(...bucket[level].slice(0, need));
    bucket[level] = bucket[level].slice(need);
  });

  const remainingPool = shuffle([...bucket.Remember, ...bucket.Understand, ...bucket.Analyze]);
  while (picked.length < totalQuestions && remainingPool.length) {
    picked.push(remainingPool.shift());
  }

  return shuffle(picked.slice(0, totalQuestions));
}

function extractJsonObject(rawText) {
  const cleaned = (rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : cleaned;
}

const mcqSchema = z.object({
  mcqs: z.array(
    z.object({
      question: z.string().min(5),
      options: z.array(z.string()).length(4),
      correctAnswer: z.number().int().min(0).max(3),
      level: z.string().optional(),
      explanation: z.string().optional(),
    })
  ).min(4).max(12),   // Flexible range
});

const targetedMcqSchema = z.object({
  mcqs: z.array(
    z.object({
      question: z.string().min(5),
      options: z.array(z.string()).length(4),
      correctAnswer: z.number().int().min(0).max(3),
      level: z.string(),
      explanation: z.string().optional(),
    })
  ).min(1).max(80),
});

function extractJsonArray(rawText) {
  const cleaned = (rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  return arrMatch ? arrMatch[0] : "";
}

function normalizeMcqList(items = []) {
  const seen = new Set();
  const list = [];

  items.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const question = String(item.question || "").trim();
    if (!question || seen.has(question.toLowerCase())) return;

    let options = Array.isArray(item.options) ? item.options.map((opt) => String(opt || "").trim()).filter(Boolean) : [];
    if (options.length < 4) return;
    options = options.slice(0, 4);

    const correctAnswer = Number(item.correctAnswer);
    if (!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer > 3) return;

    list.push({
      question,
      options,
      correctAnswer,
      explanation: String(item.explanation || "").trim(),
      level: normalizeLevel(item.level, LEVELS[i % LEVELS.length]),
    });

    seen.add(question.toLowerCase());
  });

  return list;
}

function parseTargetedMcqs(rawText) {
  const candidates = [];
  const objText = extractJsonObject(rawText);
  const arrText = extractJsonArray(rawText);
  if (objText) candidates.push(objText);
  if (arrText && arrText !== objText) candidates.push(arrText);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return normalizeMcqList(parsed);
      }
      const result = targetedMcqSchema.safeParse(parsed);
      if (result.success && Array.isArray(result.data.mcqs)) {
        return normalizeMcqList(result.data.mcqs);
      }
      if (parsed && Array.isArray(parsed.mcqs)) {
        return normalizeMcqList(parsed.mcqs);
      }
    } catch {}
  }

  return [];
}

export async function generateMCQs(subjectId, moduleId, department, semester) {
  const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY_MCQS,
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/3 - Generating MCQs for ${moduleId}`);

      const { text: rawText } = await generateText({
        model: groq('openai/gpt-oss-120b'),
        prompt: `You are a strict JSON generator. Output **ONLY** valid JSON, nothing else.

Subject: ${subjectId}
Module: ${moduleId}
Department: ${department}
Semester: ${semester}

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

      const cleaned = extractJsonObject(rawText);

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

export async function generateTargetedMCQs({
  subjectId,
  moduleIds = [],
  department,
  semester,
  totalQuestions = 30,
  weakByLevel = {},
}) {
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY_MCQS });

  const total = Math.max(6, Number(totalQuestions) || 30);
  const levelTargets = buildLevelTargets(total, weakByLevel);
  const moduleList = Array.isArray(moduleIds) && moduleIds.length > 0 ? moduleIds : ["module1"];
  const pooled = [];
  const seenQuestions = new Set();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text: rawText } = await generateText({
        model: groq('openai/gpt-oss-120b'),
        prompt: `You are a strict JSON generator for engineering exam MCQs.
Return ONLY valid JSON, no markdown and no extra text.

Context:
- Department: ${department}
- Semester: ${semester}
- Subject: ${subjectId}
- Modules: ${moduleList.join(", ")}

Generate exactly ${total} MCQs with Bloom levels and this target level distribution:
- Remember: ${levelTargets.Remember}
- Understand: ${levelTargets.Understand}
- Analyze: ${levelTargets.Analyze}

JSON format:
{
  "mcqs": [
    {
      "question": "Question text?",
      "level": "Remember|Understand|Analyze",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "short reason"
    }
  ]
}`,
        temperature: 0.45,
        maxTokens: 6000,
      });

      const normalized = parseTargetedMcqs(rawText);
      normalized.forEach((item) => {
        const key = item.question.toLowerCase();
        if (seenQuestions.has(key)) return;
        seenQuestions.add(key);
        pooled.push(item);
      });

      const finalSet = enforceExactCountWithLevels(pooled, total, levelTargets);
      if (finalSet.length === total) {
        return { mcqs: finalSet, levelTargets };
      }
    } catch (err) {
      if (attempt === 3 && pooled.length === 0) {
        throw new Error(`Failed to generate targeted MCQs: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }

  if (pooled.length > 0) {
    const finalSet = enforceExactCountWithLevels(pooled, total, levelTargets);
    if (finalSet.length === total) {
      return { mcqs: finalSet, levelTargets };
    }
  }

  throw new Error(`Could not generate a valid ${total}-question quiz.`);
}
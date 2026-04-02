'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, db } from '@/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { generateMCQs } from '@/app/actions/generate-mcqs';

function QuizPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const subject = searchParams.get('subject');
  const modulesParam = searchParams.get('modules');
  const selectedModuleKeys = modulesParam ? modulesParam.split(',') : [];

  const [user, setUser] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [error, setError] = useState(null);

  // Auth Check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.replace('/');
        return;
      }
      setUser(currentUser);
    });
    return () => unsub();
  }, [router]);

  // Generate Quiz - Only run once when user is ready
  const loadAndGenerate = useCallback(async () => {
    if (!user || !subject || selectedModuleKeys.length === 0) {
      setGenerating(false);
      setLoading(false);
      return;
    }

    setGenerating(true);
    setError(null);
    let allQuestions = [];

    try {
      const userRef = ref(db, `users/${user.uid}`);
      const userSnap = await get(userRef);
      const userData = userSnap.val() || {};

      const department = userData.branch || userData.department || 'IT';
      const semester = userData.sem ? `Sem:${userData.sem}` : 'Sem:5';

      console.log(`🔍 Starting quiz generation → Dept: ${department} | Sem: ${semester} | Subject: ${subject}`);

      for (const moduleKey of selectedModuleKeys) {
        const moduleRef = ref(db, `notes/${department}/${semester}/subjects/${subject}/modules/${moduleKey}`);
        const snapshot = await get(moduleRef);
        const moduleData = snapshot.val();

        if (moduleData) {
          console.log(`✅ Module ${moduleKey} found in Firebase`);
          const mcqs = await generateMCQs(subject, moduleKey, department, semester);
          allQuestions = [...allQuestions, ...mcqs];
        } else {
          console.warn(`⚠️ Module ${moduleKey} not found`);
        }
      }

      if (allQuestions.length === 0) {
        throw new Error("No questions could be generated. Check Firebase module content.");
      }

      allQuestions = allQuestions.sort(() => Math.random() - 0.5);
      setQuestions(allQuestions);
      console.log(`🎉 Quiz ready with ${allQuestions.length} questions`);
    } catch (err) {
      console.error("Error generating quiz:", err);
      setError(err.message || "Failed to generate questions. Please try again.");
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, [user, subject, selectedModuleKeys]);

  // Run generation only when dependencies change
  useEffect(() => {
    loadAndGenerate();
  }, [loadAndGenerate]);

  // Quiz Handlers
  const handleOptionSelect = (optionIndex) => {
    setSelectedAnswers({ ...selectedAnswers, [currentQuestionIndex]: optionIndex });
  };

  const goToNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const goToPrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const submitTest = () => {
    let correct = 0;
    questions.forEach((q, i) => {
      if (selectedAnswers[i] === q.correctAnswer) correct++;
    });
    setScore(correct);
    setSubmitted(true);
  };

  // ==================== RENDERING ====================

  if (loading || generating) {
    return (
      <div style={{ minHeight: '100vh', background: '#080f1a', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🧠</div>
        <h2>Generating Smart Quiz with Groq...</h2>
        <p style={{ marginTop: '20px', color: '#94a3b8' }}>This may take 10-20 seconds</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#080f1a', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' }}>
        <p style={{ color: '#f87171', fontSize: '18px' }}>⚠️ {error}</p>
        <button 
          onClick={() => router.push('/test')}
          style={{ marginTop: '40px', padding: '14px 32px', background: '#00FF00', color: '#0f172a', border: 'none', borderRadius: '9999px', fontWeight: 700 }}
        >
          Back to Tests
        </button>
      </div>
    );
  }

  if (submitted) {
    const percentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '40px auto', textAlign: 'center', background: '#0f172a', borderRadius: '20px' }}>
        <h1 style={{ fontSize: '42px' }}>Test Complete!</h1>
        <p style={{ fontSize: '72px', fontWeight: 900, color: '#00FF00', margin: '20px 0' }}>
          {score} / {questions.length}
        </p>
        <p style={{ fontSize: '24px', color: percentage >= 70 ? '#00FF00' : '#f59e0b' }}>
          {percentage}% — {percentage >= 70 ? 'Excellent!' : percentage >= 50 ? 'Good Job' : 'Keep Practicing'}
        </p>
        <button
          onClick={() => router.push('/test')}
          style={{ marginTop: '40px', padding: '16px 36px', background: '#00FF00', color: '#0f172a', border: 'none', borderRadius: '9999px', fontWeight: 800 }}
        >
          Back to Tests
        </button>
      </div>
    );
  }

  const currentQ = questions[currentQuestionIndex];

  return (
    <div style={{ minHeight: '100vh', background: '#080f1a', color: '#f1f5f9', padding: '20px' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <h1 style={{ fontSize: '24px' }}>{subject} — Quiz</h1>
          <div style={{ fontSize: '15px', color: '#94a3b8' }}>
            Question {currentQuestionIndex + 1} of {questions.length}
          </div>
        </div>

        <div style={{ height: '6px', background: '#1e2937', borderRadius: '9999px', marginBottom: '40px' }}>
          <div style={{ height: '100%', width: `${((currentQuestionIndex + 1) / questions.length) * 100}%`, background: '#00FF00', borderRadius: '9999px' }} />
        </div>

        <div style={{ background: '#0f172a', padding: '32px', borderRadius: '20px', marginBottom: '30px', fontSize: '18px', lineHeight: '1.7' }}>
          {currentQ?.question}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {currentQ?.options?.map((option, idx) => (
            <button
              key={idx}
              onClick={() => handleOptionSelect(idx)}
              style={{
                padding: '18px 24px',
                borderRadius: '14px',
                border: selectedAnswers[currentQuestionIndex] === idx ? '2px solid #00FF00' : '2px solid #334155',
                background: selectedAnswers[currentQuestionIndex] === idx ? 'rgba(0,255,0,0.12)' : '#1e2937',
                textAlign: 'left',
                fontSize: '16.5px',
                cursor: 'pointer'
              }}
            >
              {String.fromCharCode(65 + idx)}. {option}
            </button>
          ))}
        </div>

        <div style={{ marginTop: '50px', display: 'flex', gap: '16px', justifyContent: 'space-between' }}>
          <button 
            onClick={goToPrev} 
            disabled={currentQuestionIndex === 0}
            style={{ padding: '14px 32px', borderRadius: '9999px', background: 'transparent', border: '1px solid #475569', color: '#94a3b8', cursor: currentQuestionIndex === 0 ? 'not-allowed' : 'pointer' }}
          >
            Previous
          </button>

          {currentQuestionIndex === questions.length - 1 ? (
            <button onClick={submitTest} style={{ padding: '14px 44px', borderRadius: '9999px', background: '#00FF00', color: '#0f172a', fontWeight: 800, border: 'none', cursor: 'pointer' }}>
              Submit Test
            </button>
          ) : (
            <button onClick={goToNext} style={{ padding: '14px 44px', borderRadius: '9999px', background: '#00FF00', color: '#0f172a', fontWeight: 800, border: 'none', cursor: 'pointer' }}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizLoading() {
  return (
    <div style={{ minHeight: '100vh', background: '#080f1a', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '20px' }}>🧠</div>
      <h2>Loading quiz...</h2>
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense fallback={<QuizLoading />}>
      <QuizPageContent />
    </Suspense>
  );
}
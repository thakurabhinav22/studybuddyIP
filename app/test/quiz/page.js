'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, db } from '@/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { generateTargetedMCQs } from '@/app/actions/generate-mcqs';
import { flushPendingUsageStats, flushUsageStats } from '@/lib/usageStats';

const BLOOM_LEVELS = ["Remember", "Understand", "Analyze"];

function normalizeQuestionLevel(level, fallback = "Understand") {
  const raw = (level || "").toString().trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes("remember")) return "Remember";
  if (raw.includes("understand") || raw.includes("compreh")) return "Understand";
  if (raw.includes("analy")) return "Analyze";
  return fallback;
}

function useTheme() {
  const KEY = 'studybuddy_theme';
  const [theme, setThemeState] = useState('system');
  const [resolved, setResolved] = useState('light');
  useEffect(() => { try { setThemeState(localStorage.getItem(KEY) || 'system'); } catch { } }, []);
  const setTheme = (val) => { try { localStorage.setItem(KEY, val); } catch { } setThemeState(val); };
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setResolved(theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme);
    update(); mq.addEventListener('change', update); return () => mq.removeEventListener('change', update);
  }, [theme]);
  return { theme, setTheme, resolved };
}

function QuizPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme, resolved } = useTheme();
  const isDark = resolved === 'dark';

  const subject = searchParams.get('subject');
  const modulesParam = searchParams.get('modules');
  const selectedModuleKeys = modulesParam ? modulesParam.split(',') : [];

  const [user, setUser] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [error, setError] = useState(null);
  const [levelTargets, setLevelTargets] = useState({ Remember: 10, Understand: 10, Analyze: 10 });
  const [quizProfile, setQuizProfile] = useState({ department: "IT", semester: "Sem:5" });
  const [submitSaving, setSubmitSaving] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [sessionTerminated, setSessionTerminated] = useState(false);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [regeneratingQuestion, setRegeneratingQuestion] = useState(false);
  const [regeneratedQuestionNumber, setRegeneratedQuestionNumber] = useState(null);
  const [pendingRegenIndex, setPendingRegenIndex] = useState(null);
  const [questionCount, setQuestionCount] = useState(30);
  const [timeLeftSec, setTimeLeftSec] = useState(30 * 60);
  const [timeExpired, setTimeExpired] = useState(false);
  const [reviewMarked, setReviewMarked] = useState({});
  const [violationSource, setViolationSource] = useState('');
  const wasHiddenRef = useRef(false);
  const wasBlurredRef = useRef(false);
  const lastViolationAtRef = useRef(0);
  const violationHandledRef = useRef(false);

  const bg = isDark ? '#080f1a' : '#f3f7f4';
  const panel = isDark ? '#0f172a' : '#ffffff';
  const panelSoft = isDark ? '#1e2937' : '#eef3ef';
  const text1 = isDark ? '#f1f5f9' : '#0f172a';
  const text2 = isDark ? '#94a3b8' : '#475569';
  const bdr = isDark ? 'rgba(0,255,0,0.18)' : 'rgba(0,180,0,0.2)';

  const examDurationSec = questionCount === 15 ? 20 * 60 : 30 * 60;
  const answeredCount = Object.keys(selectedAnswers).length;
  const reviewCount = Object.values(reviewMarked).filter(Boolean).length;
  const leftCount = Math.max(0, questions.length - answeredCount);

  const formatTime = (sec) => {
    const s = Math.max(0, Number(sec) || 0);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const requestQuizFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && document.documentElement?.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  }, []);

  const registerSwitchViolation = useCallback(async (source) => {
    if (!hasGenerated || submitted || sessionTerminated) return;
    if (showTabWarning || regeneratingQuestion) return;

    const now = Date.now();
    if (now - lastViolationAtRef.current < 1200) return;
    lastViolationAtRef.current = now;

    const nextCount = tabSwitchCount + 1;
    setTabSwitchCount(nextCount);
    setViolationSource(source || 'window/tab switch');

    if (nextCount >= 3) {
      setSessionTerminated(true);
      setWarningMessage('Session terminated after 3 window/tab switches.');
      try {
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      } catch {}
      return;
    }

    setPendingRegenIndex(currentQuestionIndex);
    setWarningMessage(`Warning: Switch #${nextCount}/3 detected (${source || 'window/tab switch'}). Continue to regenerate Question ${currentQuestionIndex + 1}.`);
    setShowTabWarning(true);
    await requestQuizFullscreen();
  }, [hasGenerated, submitted, sessionTerminated, showTabWarning, regeneratingQuestion, tabSwitchCount, currentQuestionIndex, requestQuizFullscreen]);

  const regenerateCurrentQuestion = useCallback(async (indexToRegen) => {
    if (!user || !subject || selectedModuleKeys.length === 0 || !questions[indexToRegen]) return;

    setRegeneratingQuestion(true);
    try {
      const focusLevel = normalizeQuestionLevel(questions[indexToRegen]?.level);
      const bias = { Remember: 1, Understand: 1, Analyze: 1, [focusLevel]: 10 };

      const generated = await generateTargetedMCQs({
        subjectId: subject,
        moduleIds: selectedModuleKeys,
        department: quizProfile.department,
        semester: quizProfile.semester,
        totalQuestions: 6,
        weakByLevel: bias,
      });

      const pool = Array.isArray(generated?.mcqs) ? generated.mcqs : [];
      if (!pool.length) throw new Error('No replacement question generated.');

      const replacementRaw = pool.find((q) => normalizeQuestionLevel(q?.level) === focusLevel) || pool[0];
      const replacement = {
        ...replacementRaw,
        level: normalizeQuestionLevel(replacementRaw?.level, focusLevel),
      };

      setQuestions((prev) => {
        const next = [...prev];
        next[indexToRegen] = replacement;
        return next;
      });

      setSelectedAnswers((prev) => {
        const next = { ...prev };
        delete next[indexToRegen];
        return next;
      });

      setRegeneratedQuestionNumber(indexToRegen + 1);

      const askedInc = { Remember: 0, Understand: 0, Analyze: 0 };
      askedInc[normalizeQuestionLevel(replacement?.level)] += 1;
      await flushUsageStats(db, user.uid, {
        aiQuestions: 1,
        askedByLevelIncrement: askedInc,
      });
    } catch (e) {
      setWarningMessage(`Tab switch detected. Could not regenerate question automatically (${e?.message || 'unknown error'}).`);
    } finally {
      setRegeneratingQuestion(false);
    }
  }, [user, subject, selectedModuleKeys, questions, quizProfile]);

  // Auth Check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.replace('/');
        return;
      }
      setUser(currentUser);
      void flushPendingUsageStats(db, currentUser.uid);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!hasGenerated || submitted || sessionTerminated) return;

    const onContextMenu = (e) => e.preventDefault();
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, [hasGenerated, submitted, sessionTerminated]);

  useEffect(() => {
    if (!hasGenerated || submitted || sessionTerminated) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHiddenRef.current = true;
        violationHandledRef.current = false;
        return;
      }

      if (document.visibilityState === 'visible' && wasHiddenRef.current && !violationHandledRef.current) {
        wasHiddenRef.current = false;
        violationHandledRef.current = true;
        void registerSwitchViolation('tab/window hidden');
      }
    };

    const onWindowBlur = () => {
      wasBlurredRef.current = true;
      violationHandledRef.current = false;
    };

    const onWindowFocus = () => {
      if (wasBlurredRef.current && !violationHandledRef.current) {
        wasBlurredRef.current = false;
        violationHandledRef.current = true;
        void registerSwitchViolation('alt-tab/window blur');
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [hasGenerated, submitted, sessionTerminated, registerSwitchViolation]);

  useEffect(() => {
    if (!hasGenerated || submitted || sessionTerminated || showTabWarning) return;
    if (timeExpired) return;

    const timer = setInterval(() => {
      setTimeLeftSec((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setTimeExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [hasGenerated, submitted, sessionTerminated, showTabWarning, timeExpired]);

  const handleGenerateQuiz = useCallback(async () => {
    if (!user || !subject || selectedModuleKeys.length === 0) {
      setError('Missing subject/modules. Please go back and select modules again.');
      return;
    }

    setGenerating(true);
    setError(null);
    setSubmitted(false);
    setSelectedAnswers({});
    setReviewMarked({});
    setCurrentQuestionIndex(0);
    setQuestions([]);
    setTimeExpired(false);
    setTimeLeftSec(examDurationSec);

    try {
      const userRef = ref(db, `users/${user.uid}`);
      const userSnap = await get(userRef);
      const userData = userSnap.val() || {};

      const department = userData.branch || userData.department || 'IT';
      const semester = userData.sem ? `Sem:${userData.sem}` : 'Sem:5';
      const weakByLevel = {
        Remember: Number(userData?.stats?.weakByLevel?.Remember) || 0,
        Understand: Number(userData?.stats?.weakByLevel?.Understand) || 0,
        Analyze: Number(userData?.stats?.weakByLevel?.Analyze) || 0,
      };

      setQuizProfile({ department, semester });

      const generated = await generateTargetedMCQs({
        subjectId: subject,
        moduleIds: selectedModuleKeys,
        department,
        semester,
        totalQuestions: questionCount,
        weakByLevel,
      });

      const generatedQuestions = Array.isArray(generated?.mcqs) ? generated.mcqs : [];
      if (generatedQuestions.length !== questionCount) {
        throw new Error(`Secure generation failed. Expected exactly ${questionCount} MCQs.`);
      }

      const normalizedQuestions = generatedQuestions.map((q, idx) => ({
        ...q,
        level: normalizeQuestionLevel(q?.level, BLOOM_LEVELS[idx % BLOOM_LEVELS.length]),
      }));

      const askedInc = { Remember: 0, Understand: 0, Analyze: 0 };
      normalizedQuestions.forEach((q) => {
        const lvl = normalizeQuestionLevel(q?.level);
        askedInc[lvl] += 1;
      });

      setQuestions(normalizedQuestions);
      setLevelTargets(generated?.levelTargets || askedInc);
      setHasGenerated(true);
      setTabSwitchCount(0);
      setSessionTerminated(false);
      setShowTabWarning(false);
      setPendingRegenIndex(null);
      setViolationSource('');

      await requestQuizFullscreen();

      await flushUsageStats(db, user.uid, {
        aiQuestions: normalizedQuestions.length,
        askedByLevelIncrement: askedInc,
      });
    } catch (err) {
      console.error("Error generating quiz:", err);
      setError(err.message || "Failed to generate questions. Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [user, subject, selectedModuleKeys, questionCount, examDurationSec, requestQuizFullscreen]);

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

  const toggleReviewMark = () => {
    setReviewMarked((prev) => ({
      ...prev,
      [currentQuestionIndex]: !prev[currentQuestionIndex],
    }));
  };

  const submitTest = useCallback(async () => {
    if (submitted || !user || questions.length === 0) return;

    let correct = 0;
    const weakInc = { Remember: 0, Understand: 0, Analyze: 0 };

    questions.forEach((q, i) => {
      if (selectedAnswers[i] === q.correctAnswer) {
        correct++;
      } else {
        const level = normalizeQuestionLevel(q?.level);
        weakInc[level] += 1;
      }
    });

    setScore(correct);
    setSubmitted(true);

    try {
      setSubmitSaving(true);
      await flushUsageStats(db, user.uid, {
        solvedProblems: 1,
        weakByLevelIncrement: weakInc,
      });
    } catch (e) {
      console.warn('Failed to save quiz stats:', e?.message || e);
    } finally {
      setSubmitSaving(false);
    }
  }, [submitted, user, questions, selectedAnswers]);

  useEffect(() => {
    if (!timeExpired || submitted || sessionTerminated) return;
    void submitTest();
  }, [timeExpired, submitted, sessionTerminated, submitTest]);

  // ==================== RENDERING ====================

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: text1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🧠</div>
        <h2>Loading quiz setup...</h2>
      </div>
    );
  }

  if (generating) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: text1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🧠</div>
        <h2>Generating secure {questionCount}-MCQ quiz...</h2>
        <p style={{ marginTop: '20px', color: text2 }}>Using weak-level model: Remember · Understand · Analyze</p>
      </div>
    );
  }

  if (sessionTerminated) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: text1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '620px', background: panel, border: `1px solid ${bdr}`, borderRadius: '20px', padding: '28px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', margin: '0 0 10px' }}>Session Terminated</h1>
          <p style={{ margin: 0, color: text2 }}>You switched tabs 3 times. The secure quiz session has ended.</p>
          <button
            onClick={() => router.push('/test')}
            style={{ marginTop: '24px', padding: '13px 24px', borderRadius: '12px', border: 'none', background: '#00FF00', color: '#0f172a', fontWeight: 800, cursor: 'pointer' }}
          >
            Back to Tests
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: text1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' }}>
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

  if (!hasGenerated) {
    return (
      <div style={{ minHeight: '100vh', background: bg, color: text1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '620px', background: panel, border: `1px solid ${bdr}`, borderRadius: '20px', padding: '28px' }}>
          <h1 style={{ fontSize: '28px', margin: '0 0 8px' }}>Secure Quiz Setup</h1>
          <p style={{ color: text2, margin: 0 }}>Generate MCQs for {subject || 'selected subject'} based on your weak-level model.</p>

          <div style={{ marginTop: '16px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '12px', color: text2, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Quiz Mode</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[15, 30].map((count) => {
                const active = questionCount === count;
                const minutes = count === 15 ? 20 : 30;
                return (
                  <button
                    key={count}
                    onClick={() => {
                      setQuestionCount(count);
                      setTimeLeftSec(minutes * 60);
                    }}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      border: active ? '2px solid #00FF00' : `1px solid ${bdr}`,
                      background: active ? (isDark ? 'rgba(0,255,0,0.08)' : 'rgba(0,180,0,0.08)') : panelSoft,
                      color: text1,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <p style={{ margin: 0, fontWeight: 800 }}>{count} Questions</p>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: text2 }}>{minutes} Minutes</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: '18px', padding: '14px', borderRadius: '12px', border: `1px solid ${bdr}`, background: isDark ? 'rgba(0,255,0,0.06)' : 'rgba(0,180,0,0.08)' }}>
            <p style={{ margin: 0, fontSize: '13px', color: text2 }}>Modules: {selectedModuleKeys.length}</p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: text2 }}>Department: {quizProfile.department} · {quizProfile.semester}</p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: text2 }}>Time: {questionCount === 15 ? '20' : '30'} min</p>
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: text2 }}>Secure mode: full-screen + switch monitoring (tab/alt-tab/mobile background), max 3 switches.</p>
          </div>

          {error ? <p style={{ marginTop: '14px', color: '#f87171', fontSize: '14px' }}>⚠️ {error}</p> : null}

          <div style={{ display: 'flex', gap: '10px', marginTop: '22px' }}>
            <button
              onClick={() => router.push('/test')}
              style={{ flex: 1, padding: '13px 18px', borderRadius: '12px', border: `1px solid ${bdr}`, background: 'transparent', color: text2, fontWeight: 700, cursor: 'pointer' }}
            >
              Back
            </button>
            <button
              onClick={handleGenerateQuiz}
              disabled={!subject || selectedModuleKeys.length === 0}
              style={{ flex: 2, padding: '13px 18px', borderRadius: '12px', border: 'none', background: (!subject || selectedModuleKeys.length === 0) ? 'rgba(0,255,0,0.35)' : '#00FF00', color: '#0f172a', fontWeight: 800, cursor: (!subject || selectedModuleKeys.length === 0) ? 'not-allowed' : 'pointer' }}
            >
              Generate {questionCount} MCQs
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    const percentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '40px auto', textAlign: 'center', background: panel, border: `1px solid ${bdr}`, borderRadius: '20px' }}>
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
    <>
      <style>{`
        .ms { font-family:'Material Symbols Outlined'!important; font-weight:normal; font-style:normal; font-size:24px; line-height:1; display:inline-block; white-space:nowrap; }
        .quiz-layout { display:grid; grid-template-columns:minmax(0,1fr) 250px; gap:16px; }
        .q-palette { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; }
        .mob-nav {
          display:none; position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
          z-index:300; background:${isDark ? "rgba(14,20,36,0.95)" : "rgba(255,255,255,0.92)"};
          backdrop-filter:blur(28px); -webkit-backdrop-filter:blur(28px);
          border:1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)"}; border-radius:9999px;
          padding:8px 24px; align-items:center; gap:6px; box-shadow:0 12px 48px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.12);
          min-width:340px;
        }
        .mob-tab {
          width:54px; height:54px; border-radius:9999px; display:flex; align-items:center; justify-content:center;
          background:none; border:none; cursor:pointer; font-family:'Inter',sans-serif;
          -webkit-tap-highlight-color:transparent; transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background 0.18s;
          flex-shrink:0;
        }
        .mob-tab:active { transform:scale(0.80); }
        .mob-tab .ms {
          font-size:22px; color:${isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.32)"}; transition:color 0.18s;
        }
        .mob-tab.active { background:#00FF00; box-shadow:0 4px 22px rgba(0,255,0,0.55); transform:scale(1.12); }
        .mob-tab.active .ms { color:#0a1a0a; }
        .mob-tab.danger .ms { color:#f87171; }
        @media(max-width:1024px){
          .quiz-layout { grid-template-columns:1fr; }
        }
        @media(max-width:768px){
          .mob-nav { display:flex!important; }
        }
      `}</style>
      <div style={{ minHeight: '100vh', background: bg, color: text1, padding: '20px' }}>
      <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '24px', margin: 0 }}>{subject} — Secure Quiz</h1>
            <p style={{ fontSize: '12px', color: text2, marginTop: '4px' }}>
              R:{levelTargets.Remember || 0} · U:{levelTargets.Understand || 0} · A:{levelTargets.Analyze || 0}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14px', color: text2 }}>
              Question {currentQuestionIndex + 1} of {questions.length}
            </div>
            <div style={{ padding: '8px 12px', borderRadius: '9999px', border: `1px solid ${bdr}`, background: panelSoft, fontSize: '13px', fontWeight: 800, color: timeLeftSec <= 120 ? '#ef4444' : text1 }}>
              ⏱ {formatTime(timeLeftSec)}
            </div>
            <div style={{ padding: '8px 12px', borderRadius: '9999px', border: `1px solid ${bdr}`, background: panelSoft, fontSize: '12px', color: text2 }}>
              Switches: {tabSwitchCount}/3
            </div>
          </div>
        </div>

        <div style={{ height: '6px', background: panelSoft, borderRadius: '9999px', marginBottom: '40px' }}>
          <div style={{ height: '100%', width: `${((currentQuestionIndex + 1) / questions.length) * 100}%`, background: '#00FF00', borderRadius: '9999px' }} />
        </div>

        <div className="quiz-layout">
          <div>
            <div style={{ background: panel, border: `1px solid ${bdr}`, padding: '32px', borderRadius: '20px', marginBottom: '18px', fontSize: '18px', lineHeight: '1.7' }}>
              {currentQ?.question}
              <p style={{ marginTop: '10px', fontSize: '12px', color: text2 }}>
                Level: {normalizeQuestionLevel(currentQ?.level)}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {currentQ?.options?.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => handleOptionSelect(idx)}
                  style={{
                    padding: '18px 24px',
                    borderRadius: '14px',
                    border: selectedAnswers[currentQuestionIndex] === idx ? '2px solid #00FF00' : `2px solid ${isDark ? '#334155' : '#cbd5e1'}`,
                    background: selectedAnswers[currentQuestionIndex] === idx ? 'rgba(0,255,0,0.12)' : panelSoft,
                    color: text1,
                    textAlign: 'left',
                    fontSize: '16.5px',
                    cursor: 'pointer'
                  }}
                >
                  {String.fromCharCode(65 + idx)}. {option}
                </button>
              ))}
            </div>

            <div style={{ marginTop: '26px', display: 'flex', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <button
                onClick={toggleReviewMark}
                style={{ padding: '12px 18px', borderRadius: '12px', background: reviewMarked[currentQuestionIndex] ? 'rgba(250,204,21,0.2)' : 'transparent', border: `1px solid ${reviewMarked[currentQuestionIndex] ? '#facc15' : bdr}`, color: reviewMarked[currentQuestionIndex] ? '#facc15' : text2, fontWeight: 700, cursor: 'pointer' }}
              >
                {reviewMarked[currentQuestionIndex] ? 'Marked for Review' : 'Mark for Review'}
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={goToPrev}
                  disabled={currentQuestionIndex === 0}
                  style={{ padding: '12px 20px', borderRadius: '12px', background: 'transparent', border: `1px solid ${isDark ? '#475569' : '#94a3b8'}`, color: text2, cursor: currentQuestionIndex === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Previous
                </button>

                {currentQuestionIndex === questions.length - 1 ? (
                  <button onClick={submitTest} disabled={submitSaving} style={{ padding: '12px 22px', borderRadius: '12px', background: '#00FF00', color: '#0f172a', fontWeight: 800, border: 'none', cursor: submitSaving ? 'wait' : 'pointer', opacity: submitSaving ? 0.8 : 1 }}>
                    {submitSaving ? 'Saving Results...' : 'Submit Test'}
                  </button>
                ) : (
                  <button onClick={goToNext} style={{ padding: '12px 22px', borderRadius: '12px', background: '#00FF00', color: '#0f172a', fontWeight: 800, border: 'none', cursor: 'pointer' }}>
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>

          <aside style={{ background: panel, border: `1px solid ${bdr}`, borderRadius: '16px', padding: '14px', height: 'fit-content', position: 'sticky', top: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: text1 }}>Question Panel</h3>
            <p style={{ margin: '6px 0 10px', fontSize: '11px', color: text2 }}>Select question number</p>

            <div className="q-palette">
              {questions.map((_, idx) => {
                const answered = selectedAnswers[idx] !== undefined;
                const review = !!reviewMarked[idx];
                const active = idx === currentQuestionIndex;
                const baseBg = active ? '#00FF00' : review ? (isDark ? 'rgba(250,204,21,0.18)' : 'rgba(250,204,21,0.24)') : answered ? (isDark ? 'rgba(0,255,0,0.12)' : 'rgba(0,180,0,0.12)') : panelSoft;
                const baseColor = active ? '#0f172a' : review ? '#facc15' : text1;

                return (
                  <button
                    key={`qnav-${idx}`}
                    onClick={() => setCurrentQuestionIndex(idx)}
                    style={{
                      height: '34px',
                      borderRadius: '9px',
                      border: active ? '2px solid #00FF00' : `1px solid ${bdr}`,
                      background: baseBg,
                      color: baseColor,
                      fontWeight: 800,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: '12px', fontSize: '11px', color: text2, lineHeight: 1.55 }}>
              <p style={{ margin: 0 }}>Answered: {answeredCount}</p>
              <p style={{ margin: 0 }}>Left: {leftCount}</p>
              <p style={{ margin: 0 }}>Review: {reviewCount}</p>
              <p style={{ margin: '6px 0 0' }}>Switches: {tabSwitchCount}/3 {violationSource ? `(${violationSource})` : ''}</p>
              {regeneratedQuestionNumber ? <p style={{ margin: '4px 0 0' }}>Last regenerated: Q{regeneratedQuestionNumber}</p> : null}
            </div>
          </aside>
        </div>
      </div>
      </div>

      {showTabWarning && (
        <div style={{ position: 'fixed', inset: 0, background: isDark ? 'rgba(2,6,23,0.78)' : 'rgba(15,23,42,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 999 }}>
          <div style={{ width: '100%', maxWidth: '520px', background: panel, border: `1px solid ${bdr}`, borderRadius: '18px', padding: '22px' }}>
            <h3 style={{ margin: 0, color: text1 }}>Tab Switch Warning</h3>
            <p style={{ margin: '10px 0 0', color: text2, lineHeight: 1.5 }}>{warningMessage || 'You switched tabs. Click continue to regenerate current question.'}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={async () => {
                  const idx = typeof pendingRegenIndex === 'number' ? pendingRegenIndex : currentQuestionIndex;
                  await regenerateCurrentQuestion(idx);
                  setPendingRegenIndex(null);
                  setShowTabWarning(false);
                }}
                disabled={regeneratingQuestion}
                style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: '#00FF00', color: '#0f172a', fontWeight: 800, cursor: regeneratingQuestion ? 'wait' : 'pointer', opacity: regeneratingQuestion ? 0.85 : 1 }}
              >
                {regeneratingQuestion ? 'Regenerating...' : 'Continue & Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MOBILE BOTTOM NAV ══ */}
      <nav className="mob-nav">
        <button className="mob-tab" onClick={() => router.push('/dashboard')}>
          <span className="ms">home</span>
        </button>
        <button className="mob-tab" onClick={() => router.push('/notes')}>
          <span className="ms">library_books</span>
        </button>
        <button className="mob-tab active" onClick={() => router.push('/test')}>
          <span className="ms">quiz</span>
        </button>
        <button className="mob-tab" onClick={() => router.push('/ai')}>
          <span className="ms">auto_awesome</span>
        </button>
        <button className="mob-tab" onClick={() => router.push('/profile')}>
          <span className="ms">person</span>
        </button>
      </nav>
    </>
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
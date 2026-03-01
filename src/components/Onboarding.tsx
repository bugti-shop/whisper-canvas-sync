import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, FileText, CheckSquare, Palette, FolderTree, Clock, Shield, Users, Bell, Zap, Brain, Sparkles, Target, Layers, PenTool } from 'lucide-react';
import { triggerHaptic, triggerNotificationHaptic } from '@/utils/haptics';
import { getSuggestedFolders, getSuggestedNoteTypes } from '@/utils/personalization';
import { setVisibleNoteTypes } from '@/utils/noteTypeVisibility';
import { setSetting } from '@/utils/settingsStorage';
import { useTranslation } from 'react-i18next';
import appLogo from '@/assets/app-logo.png';

interface OnboardingProps {
  onComplete: () => void;
}

interface OnboardingStep {
  id: string;
  question: string;
  subtitle?: string;
  options: {
    emoji: string;
    label: string;
    description?: string;
    value: string;
  }[];
  allowMultiple?: boolean;
}

const steps: OnboardingStep[] = [
  {
    id: 'purpose',
    question: "What brings you here?",
    subtitle: "We'll personalize your experience",
    options: [
      { emoji: '💼', label: 'Work & Projects', description: 'Stay on top of tasks', value: 'work' },
      { emoji: '📓', label: 'Personal Journal', description: 'Capture daily thoughts', value: 'journal' },
      { emoji: '📚', label: 'Study & Learning', description: 'Organize study notes', value: 'study' },
      { emoji: '🎨', label: 'Creative Writing', description: 'Express yourself freely', value: 'creative' },
    ],
  },
  {
    id: 'organize',
    question: "How do you like to organize?",
    subtitle: "Pick what feels natural",
    options: [
      { emoji: '📂', label: 'Folders & Categories', value: 'folders' },
      { emoji: '🏷️', label: 'Tags & Labels', value: 'tags' },
      { emoji: '🎨', label: 'Color Coding', value: 'colors' },
      { emoji: '📅', label: 'By Date & Time', value: 'date' },
    ],
  },
  {
    id: 'style',
    question: "What's your note-taking style?",
    options: [
      { emoji: '⚡', label: 'Quick Bullet Points', value: 'bullets' },
      { emoji: '📝', label: 'Detailed Paragraphs', value: 'detailed' },
      { emoji: '🎙️', label: 'Voice Recordings', value: 'voice' },
      { emoji: '📊', label: 'Tables & Structured', value: 'tables' },
    ],
  },
  {
    id: 'frequency',
    question: "How often will you use this?",
    subtitle: "This helps us set the right reminders",
    options: [
      { emoji: '🔥', label: 'Multiple times daily', value: 'daily' },
      { emoji: '📆', label: 'Few times a week', value: 'weekly' },
      { emoji: '🌙', label: 'Occasionally', value: 'occasional' },
      { emoji: '💎', label: 'Rarely, but important', value: 'rare' },
    ],
  },
  {
    id: 'priority',
    question: "What matters most to you?",
    options: [
      { emoji: '🔒', label: 'Privacy & Security', value: 'privacy' },
      { emoji: '⚡', label: 'Speed & Quick Access', value: 'speed' },
      { emoji: '✨', label: 'Rich Formatting', value: 'formatting' },
      { emoji: '📤', label: 'Easy Sharing', value: 'sharing' },
    ],
  },
  {
    id: 'challenge',
    question: "What's your biggest challenge?",
    subtitle: "We'll help you overcome it",
    options: [
      { emoji: '🎯', label: 'Staying Consistent', value: 'consistency' },
      { emoji: '🗂️', label: 'Too Many Scattered Notes', value: 'scattered' },
      { emoji: '⏰', label: 'Not Enough Time', value: 'time' },
      { emoji: '🔍', label: 'Finding Old Notes', value: 'finding' },
    ],
  },
  {
    id: 'goal',
    question: "What's your #1 goal?",
    subtitle: "Let's make it happen together",
    options: [
      { emoji: '🧠', label: 'Better Daily Habits', value: 'habits' },
      { emoji: '📋', label: 'More Organization', value: 'organization' },
      { emoji: '🚀', label: 'Faster Note Capture', value: 'capture' },
      { emoji: '🎨', label: 'Creative Expression', value: 'expression' },
    ],
  },
];

export const Onboarding = ({ onComplete }: OnboardingProps) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(-1); // -1 = splash
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [direction, setDirection] = useState<1 | -1>(1);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionProgress, setCompletionProgress] = useState(0);

  const totalSteps = steps.length;
  const progress = currentStep < 0 ? 0 : ((currentStep + 1) / totalSteps) * 100;

  const handleSelect = useCallback(async (value: string) => {
    triggerHaptic('heavy');
    setAnswers(prev => ({ ...prev, [currentStep]: value }));
  }, [currentStep]);

  const handleContinue = useCallback(async () => {
    triggerHaptic('heavy');
    setDirection(1);
    
    if (currentStep < totalSteps - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Final step - show completion
      setIsCompleting(true);
      triggerNotificationHaptic('success');
      
      // Animate progress
      const interval = setInterval(() => {
        setCompletionProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 2;
        });
      }, 30);
      
      // Save answers and apply personalization
      await setSetting('onboardingAnswers', answers);
      await setSetting('onboardingComplete', 'true');
      
      // Apply personalized note types
      const suggestedTypes = getSuggestedNoteTypes(answers);
      if (suggestedTypes.length > 0) {
        await setVisibleNoteTypes(suggestedTypes);
      }
      
      // Apply personalized folders
      const suggestedFolders = getSuggestedFolders(answers);
      if (suggestedFolders.length > 0) {
        const folders = suggestedFolders.map((name, index) => ({
          id: `folder-${Date.now()}-${index}`,
          name,
          isDefault: false,
          createdAt: new Date(),
          color: ['#3c78f0', '#10b981', '#f59e0b'][index % 3],
        }));
        await setSetting('folders', folders);
      }
      
      setTimeout(() => {
        clearInterval(interval);
        triggerNotificationHaptic('success');
        onComplete();
      }, 2000);
    }
  }, [currentStep, totalSteps, answers, onComplete]);

  const handleBack = useCallback(async () => {
    triggerHaptic('medium');
    setDirection(-1);
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    } else if (currentStep === 0) {
      setCurrentStep(-1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(async () => {
    triggerHaptic('medium');
    await setSetting('onboardingComplete', 'skipped');
    onComplete();
  }, [onComplete]);

  const handleGetStarted = useCallback(async () => {
    triggerHaptic('heavy');
    setDirection(1);
    setCurrentStep(0);
  }, []);

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -300 : 300,
      opacity: 0,
    }),
  };

  // Completion screen
  if (isCompleting) {
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-6"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', duration: 0.6 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="text-6xl">🎉</div>
          <h1 className="text-2xl font-bold text-foreground text-center">
            Setting up your workspace...
          </h1>
          <div className="w-64 h-3 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${completionProgress}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {completionProgress < 40 ? 'Personalizing your experience...' :
             completionProgress < 70 ? 'Configuring smart features...' :
             completionProgress < 95 ? 'Almost ready...' : 'Let\'s go! 🚀'}
          </p>
        </motion.div>
      </div>
    );
  }

  // Splash screen
  if (currentStep === -1) {
    return (
      <div className="fixed inset-0 bg-primary z-50 flex flex-col items-center justify-between p-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 48px)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 32px)' }}>
        
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <motion.div
            initial={{ scale: 0.6, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', duration: 0.8 }}
          >
            <img
              src={appLogo}
              alt="App Logo"
              className="w-40 h-40 object-contain drop-shadow-2xl"
            />
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-center space-y-2"
          >
            <h1 className="text-3xl font-extrabold text-primary-foreground">
              Npd Notes
            </h1>
            <p className="text-primary-foreground/80 text-lg">
              Your notes, your way.
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="w-full max-w-md space-y-3"
        >
          <button
            onClick={handleGetStarted}
            className="w-full h-14 rounded-2xl bg-primary-foreground text-primary font-bold text-lg tracking-wide shadow-lg border-b-4 border-primary-foreground/70 active:border-b-0 active:translate-y-1 transition-all"
          >
            GET STARTED
          </button>
          <button
            onClick={handleSkip}
            className="w-full py-3 text-primary-foreground/70 font-medium text-sm"
          >
            I already know my way around
          </button>
        </motion.div>
      </div>
    );
  }

  // Question steps
  const currentQuestion = steps[currentStep];
  const selectedValue = answers[currentStep];
  const isLastStep = currentStep === totalSteps - 1;

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      
      {/* Header with back, progress bar, skip */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          
          {/* Progress bar */}
          <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
          
          <button
            onClick={handleSkip}
            className="text-muted-foreground hover:text-foreground font-medium text-sm px-2 py-1 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex-1 flex flex-col pt-4 pb-6"
          >
            {/* Question */}
            <div className="mb-2">
              <h1 className="text-2xl font-extrabold text-foreground leading-tight">
                {currentQuestion.question}
              </h1>
              {currentQuestion.subtitle && (
                <p className="text-muted-foreground mt-1.5 text-base">
                  {currentQuestion.subtitle}
                </p>
              )}
            </div>

            {/* Options */}
            <div className="flex-1 flex flex-col justify-center">
              <div className="space-y-2.5">
                {currentQuestion.options.map((option) => {
                  const isSelected = selectedValue === option.value;

                  return (
                    <motion.button
                      key={option.value}
                      onClick={() => handleSelect(option.value)}
                      whileTap={{ scale: 0.97 }}
                      className={`w-full p-4 rounded-2xl flex items-center gap-4 text-left transition-all duration-200 border-2 ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border bg-card hover:border-muted-foreground/30'
                      }`}
                    >
                      <span className="text-2xl flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-muted">
                        {option.emoji}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={`text-base font-semibold block ${
                          isSelected ? 'text-primary' : 'text-foreground'
                        }`}>
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="text-sm text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </motion.div>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Continue button */}
            <div className="pt-4">
              <button
                onClick={handleContinue}
                disabled={!selectedValue}
                className={`w-full h-14 rounded-2xl font-bold text-lg tracking-wide transition-all duration-200 ${
                  selectedValue
                    ? 'bg-primary text-primary-foreground shadow-lg border-b-4 border-primary/70 active:border-b-0 active:translate-y-1'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }`}
              >
                {isLastStep ? 'FINISH' : 'CONTINUE'}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

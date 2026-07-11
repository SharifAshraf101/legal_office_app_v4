'use client';

import { useEffect, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useModalStack } from '@/hooks/useModalStack';
import {
  TaskDeadlineAlertModal,
  taskDaysUntilDue,
} from '@/components/TaskDeadlineAlertModal';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // re-check every 30 minutes while open

/**
 * Shows the professional task-deadline alert:
 *   • On every app open — if any task is overdue (not marked done) or its
 *     deadline is within the next 3 days.
 *   • While the app stays open — again whenever a task crosses the 3-day mark,
 *     the 1-day mark, the due-today mark, or becomes overdue (once per day),
 *     as long as it hasn't been marked done.
 *
 * `enabled` gates the whole thing on "app is ready" (language chosen + hydrated)
 * so the alert never appears over the language screen or before data loads.
 */
export function useTaskDeadlineAlerts(enabled: boolean) {
  const { state } = useAppState();
  const modalStack = useModalStack();

  // Keep the latest values in refs so the effect can depend ONLY on `enabled`
  // (modalStack / state change reference often; we don't want to reset the
  // interval or re-run the startup check on every such change).
  const stateRef = useRef(state);
  stateRef.current = state;
  const modalStackRef = useRef(modalStack);
  modalStackRef.current = modalStack;

  const openRef = useRef(false);
  // Milestone keys already alerted this session (e.g. "TASK-1:1d",
  // "TASK-1:od:2026-07-11") so each threshold notifies at most once.
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    const openAlert = () => {
      if (openRef.current) return; // never stack two alerts
      openRef.current = true;
      modalStackRef.current.open(
        <TaskDeadlineAlertModal
          onClose={() => {
            openRef.current = false;
          }}
        />,
      );
    };

    const check = (startup: boolean) => {
      const tasks = stateRef.current.tasksArr || [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString().slice(0, 10);

      let hasAttention = false;
      const freshMilestones: string[] = [];

      for (const t of tasks) {
        if ((t.status ?? 'open') === 'done') continue;
        const diff = taskDaysUntilDue(t.dueDate);
        if (diff === null || diff > 3) continue;
        hasAttention = true;
        // The milestone that applies at this exact distance from the deadline.
        let key: string | null = null;
        if (diff < 0) key = `${t.id}:od:${todayISO}`; // overdue → once per day
        else if (diff === 0) key = `${t.id}:0d`;
        else if (diff === 1) key = `${t.id}:1d`;
        else if (diff === 3) key = `${t.id}:3d`;
        // diff === 2 has no milestone; it still shows in the startup list.
        if (key && !notifiedRef.current.has(key)) freshMilestones.push(key);
      }

      if (startup) {
        // Suppress an immediate duplicate from the first interval tick by
        // marking every current milestone as already notified.
        freshMilestones.forEach((k) => notifiedRef.current.add(k));
        if (hasAttention) openAlert();
      } else if (freshMilestones.length > 0) {
        freshMilestones.forEach((k) => notifiedRef.current.add(k));
        openAlert();
      }
    };

    // `enabled` flips false→true exactly once (language chosen + hydrated are
    // one-way), so this runs once in production. Under dev StrictMode the
    // setup→cleanup→setup double-invoke cancels the first timeout and the
    // second setup re-schedules, so the startup alert still fires exactly once.
    // Defer one tick so the alert mounts cleanly after the shell paints.
    const startupTimer = setTimeout(() => check(true), 400);
    const iv = setInterval(() => check(false), CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(startupTimer);
      clearInterval(iv);
    };
  }, [enabled]);
}

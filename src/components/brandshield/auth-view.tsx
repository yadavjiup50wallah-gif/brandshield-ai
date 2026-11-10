"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Eye,
  EyeOff,
  FileSearch,
  Flame,
  Fingerprint,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { markAuthHint, useDemoLogin, useLogin, useRegister } from "@/lib/brandshield/client";
import {
  firebaseEmailSignIn,
  firebaseEmailSignUp,
  isFirebaseConfigured,
  preloadFirebaseSdk,
} from "@/lib/brandshield/firebase";
import { warmSignedInChunksWhenIdle } from "@/components/brandshield/lazy-views";
import type { Role, SessionUser } from "@/lib/brandshield/types";
import { DEMO_EMAILS } from "@/lib/brandshield/shared";
import { cn, initials } from "@/lib/brandshield/utils";
import { LangToggle, useLang } from "@/lib/brandshield/i18n";
import "@/lib/brandshield/i18n/dict-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

// ─── Demo personas (names/emails are data — never translated) ────────────────

const PERSONAS = [
  {
    email: "ava@nimbus.demo",
    name: "Ava Chen",
    role: "creator",
    avatarColor: "#0F766E",
  },
  {
    email: "marcus@nimbus.demo",
    name: "Marcus Reed",
    role: "reviewer",
    avatarColor: "#B45309",
  },
  {
    email: "priya@pixelworks.demo",
    name: "Priya Sharma",
    role: "contractor",
    avatarColor: "#7C2D12",
  },
  {
    email: "elena@nimbus.demo",
    name: "Elena Rodriguez",
    role: "admin",
    avatarColor: "#4D7C0F",
  },
] as const;

const ROLE_BADGE: Record<Role, string> = {
  creator: "border-teal-200 bg-teal-50 text-teal-700",
  reviewer: "border-amber-200 bg-amber-50 text-amber-700",
  contractor: "border-orange-200 bg-orange-50 text-orange-700",
  admin: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const ROLE_OPTIONS: Role[] = ["creator", "reviewer", "contractor", "admin"];

const TRUST_MARKERS = [
  {
    icon: FileSearch,
    titleKey: "auth.trust.citations.title",
    descKey: "auth.trust.citations.desc",
  },
  {
    icon: Fingerprint,
    titleKey: "auth.trust.audit.title",
    descKey: "auth.trust.audit.desc",
  },
  {
    icon: ShieldCheck,
    titleKey: "auth.trust.retention.title",
    descKey: "auth.trust.retention.desc",
  },
] as const;

type Mode = "signin" | "signup";

// Server error codes that have localized translations (see dict-auth "err.*").
const KNOWN_ERR_CODES = new Set([
  "invalid-email",
  "missing-password",
  "weak-password",
  "missing-name",
  "email-already-in-use",
  "user-not-found",
  "wrong-password",
  "invalid-credential",
  "missing-credentials",
  "too-many-requests",
]);

// ─── Auth view ───────────────────────────────────────────────────────────────

export function AuthView({ onBack }: { onBack: () => void }) {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<Role>("creator");
  const [department, setDepartment] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  // Demo personas only exist when the deployment seeds them (DEMO_SEED not
  // set to "off"). Production deployments start clean — the buttons stay
  // hidden there and users sign up for real. null = still checking (hidden).
  const [demoEnabled, setDemoEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/demo-status")
      .then((r) => (r.ok ? r.json() : { demoEnabled: false }))
      .then((j: { demoEnabled?: boolean }) => {
        if (!cancelled) setDemoEnabled(!!j.demoEnabled);
      })
      .catch(() => {
        if (!cancelled) setDemoEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const demo = useDemoLogin();
  const login = useLogin();
  const register = useRegister();
  const queryClient = useQueryClient();
  // Firebase sign-in/up runs outside React Query, so its pending state is
  // tracked here — otherwise the submit button shows no feedback during the
  // (network-bound) Firebase auth + /api/auth/firebase-sync round trip and
  // the swap to the dashboard feels broken/stuck.
  const [firebaseBusy, setFirebaseBusy] = useState(false);
  const busy = login.isPending || register.isPending || demo.isPending || firebaseBusy;

  // While the user types their credentials, prefetch the signed-in chunks at
  // idle time — first sign-in swaps into the dashboard with zero chunk wait.
  // The Firebase SDK chunks download right away (small, and definitely needed
  // the moment the user submits) so first sign-in skips that round trip too.
  useEffect(() => {
    warmSignedInChunksWhenIdle();
    preloadFirebaseSdk();
  }, []);

  // Swap straight into the dashboard SPA-style — no full page reload, so the
  // session query is satisfied from the synced user and the shell mounts
  // immediately (signed-in chunks are already warmed by the shell itself).
  function finishFirebaseSession(user: SessionUser) {
    markAuthHint();
    queryClient.setQueryData(["session"], user);
  }
  const rawError = (mode === "signin" ? login.error : register.error) ?? null;
  // Server codes arrive Firebase-style ("auth/email-already-in-use") — strip
  // the namespace for dictionary lookup, e.g. auth.err.email-already-in-use.
  const rawErrCode = (rawError as (Error & { code?: string }) | null)?.code?.split("/").pop();
  // Localize known Firebase-style codes; rare/unknown codes fall back to the
  // server message (they only occur with external providers attached).
  const formError = rawError
    ? rawErrCode && KNOWN_ERR_CODES.has(rawErrCode)
      ? t(`auth.err.${rawErrCode}`)
      : rawError.message
    : null;
  const firebaseConnected = isFirebaseConfigured();

  function handleDemo(personaEmail: string, personaName: string) {
    demo.mutate(personaEmail, {
      onSuccess: (user) =>
        toast.success(t("auth.toast.signedInAs", { name: user.name || personaName })),
    });
  }

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const finish = () => toast.success(t("auth.toast.signedIn"));
    const cleanEmail = email.trim().toLowerCase();
    if (firebaseConnected && !DEMO_EMAILS.has(cleanEmail)) {
      setFirebaseBusy(true);
      firebaseEmailSignIn(cleanEmail, password)
        .then(finishFirebaseSession)
        .catch((err: Error) => toast.error(err.message))
        .finally(() => setFirebaseBusy(false));
      return;
    }
    login.mutate({ email: cleanEmail, password }, { onSuccess: finish });
  }

  function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      toast.error(t("auth.toast.passwordMismatch"));
      return;
    }
    if (firebaseConnected) {
      setFirebaseBusy(true);
      firebaseEmailSignUp({ email: email.trim(), password, name: name.trim() })
        .then(finishFirebaseSession)
        .catch((err: Error) => toast.error(err.message))
        .finally(() => setFirebaseBusy(false));
      return;
    }
    register.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        department: department.trim() || undefined,
        organizationName: organizationName.trim() || undefined,
      },
      {
        onSuccess: (user) => {
          toast.success(t("auth.toast.welcome", { name: user.name.split(" ")[0] }));
        },
      }
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-white via-white to-teal-50 p-4 sm:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-teal-900/5 lg:grid-cols-2"
      >
        {/* ── Brand panel (desktop) ── */}
        <aside className="hidden flex-col justify-between border-r border-slate-100 bg-gradient-to-br from-teal-50 via-white to-white p-8 lg:flex">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-700 to-emerald-600 text-white shadow-sm">
                <ShieldCheck className="size-5" />
              </span>
              <span className="text-base font-semibold tracking-tight text-slate-900">
                BrandShield <span className="text-teal-700">AI</span>
              </span>
            </div>
            <p className="mt-6 max-w-xs text-lg font-medium leading-snug text-slate-700">
              {t("auth.brand.tagline")}
            </p>
          </div>

          <ul className="space-y-5">
            {TRUST_MARKERS.map((marker) => (
              <li key={marker.titleKey} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-white text-teal-700 shadow-sm">
                  <marker.icon className="size-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t(marker.titleKey)}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t(marker.descKey)}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-xs text-slate-400">{t("auth.brand.footnote")}</p>
        </aside>

        {/* ── Auth panel ── */}
        <div className="min-w-0 p-5 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="-ml-2 h-8 gap-1.5 px-2 text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">{t("auth.action.backFull")}</span>
              <span className="sm:hidden">{t("common.action.back")}</span>
            </Button>
            <div className="flex items-center gap-2">
              {/* Language switcher — usable before signing in, on mobile too */}
              <LangToggle />
              <Badge
                title={
                  firebaseConnected
                    ? t("auth.badge.connectedTitle")
                    : t("auth.badge.localTitle")
                }
                className={cn(
                  "gap-1 border font-medium",
                  firebaseConnected
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                )}
              >
                <Flame className="size-3 text-orange-500" />
                <span className="hidden sm:inline">Firebase Auth</span>
                <span className="sm:hidden">Firebase</span>
                <span className={cn("ml-0.5 whitespace-nowrap rounded px-1 py-px text-[10px] font-semibold", firebaseConnected ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>
                  {firebaseConnected ? t("auth.badge.connected") : t("auth.badge.localMode")}
                </span>
              </Badge>
            </div>
          </div>

          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
            {mode === "signin" ? t("auth.signin.title") : t("auth.signup.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "signin" ? t("auth.signin.subtitle") : t("auth.signup.subtitle")}
          </p>

          {/* Mode tabs */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={t("auth.aria.modeTabs")}>
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "relative rounded-lg py-2 text-sm font-medium transition-colors",
                  mode === m ? "text-teal-800" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="auth-tab-pill"
                    className="absolute inset-0 rounded-lg bg-white shadow-sm"
                    transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
                  />
                )}
                <span className="relative">{m === "signin" ? t("auth.tab.signin") : t("auth.tab.signup")}</span>
              </button>
            ))}
          </div>

          <div className="mt-5">
            <AnimatePresence mode="wait" initial={false}>
              {mode === "signin" ? (
                <motion.div
                  key="signin"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.18 }}
                >
                  {/* Demo personas (hidden on clean production deployments) */}
                  {demoEnabled && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                        {t("auth.demo.heading")}
                      </p>
                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {PERSONAS.map((persona) => (
                          <button
                            key={persona.email}
                            type="button"
                            disabled={demo.isPending}
                            onClick={() => handleDemo(persona.email, persona.name)}
                            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60"
                          >
                            <Avatar className="size-10 border border-black/5">
                              <AvatarFallback
                                style={{ backgroundColor: persona.avatarColor }}
                                className="text-sm font-semibold text-white"
                              >
                                {initials(persona.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-semibold text-slate-900">{persona.name}</span>
                                <Badge
                                  variant="outline"
                                  className={cn("px-1.5 py-0 text-[10px] font-medium", ROLE_BADGE[persona.role as Role])}
                                >
                                  {t(`common.role.${persona.role}`)}
                                </Badge>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {t(`auth.persona.title.${persona.role}`)}
                              </p>
                            </div>
                            {demo.isPending && demo.variables === persona.email ? (
                              <Loader2 className="size-4 shrink-0 animate-spin text-teal-600" />
                            ) : (
                              <ArrowRight className="size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" />
                            )}
                          </button>
                        ))}
                      </div>

                      <div className="relative my-5">
                        <div className="absolute inset-0 flex items-center">
                          <Separator className="w-full" />
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-white px-3 text-xs text-slate-400">{t("auth.divider.orEmail")}</span>
                        </div>
                      </div>
                    </>
                  )}

                  <form onSubmit={handleLogin} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-email">{t("auth.field.email")}</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="auth-email"
                          type="email"
                          autoComplete="email"
                          placeholder="ava@nimbus.demo"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="h-10 rounded-xl pl-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-password">{t("auth.field.password")}</Label>
                      <PasswordInput
                        id="auth-password"
                        autoComplete="current-password"
                        placeholder="demo1234"
                        value={password}
                        onChange={setPassword}
                        show={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                      />
                      <p className="text-xs text-slate-400">
                        {t("auth.signin.helperPrefix")}{" "}
                        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-600">
                          demo1234
                        </code>
                        {t("auth.signin.helperSuffix")}
                      </p>
                    </div>

                    {formError && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        role="alert"
                        className="text-sm font-medium text-red-600"
                      >
                        {formError}
                      </motion.p>
                    )}

                    <Button
                      type="submit"
                      disabled={busy}
                      className="h-10 w-full rounded-xl bg-teal-700 text-white shadow-sm hover:bg-teal-800"
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                      {busy ? t("auth.action.signingIn") : t("auth.action.signIn")}
                    </Button>
                  </form>
                </motion.div>
              ) : (
                <motion.form
                  key="signup"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.18 }}
                  onSubmit={handleRegister}
                  className="space-y-4"
                  noValidate
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-name">{t("auth.signup.name")}</Label>
                      <div className="relative">
                        <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="reg-name"
                          autoComplete="name"
                          placeholder={t("auth.signup.namePlaceholder")}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="h-10 rounded-xl pl-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-dept">
                        {t("auth.signup.department")} <span className="font-normal text-slate-400">{t("auth.optional")}</span>
                      </Label>
                      <Input
                        id="reg-dept"
                        placeholder={t("auth.signup.deptPlaceholder")}
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="h-10 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reg-org">
                      {t("auth.signup.organization")} <span className="font-normal text-slate-400">{t("auth.optional")}</span>
                    </Label>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="reg-org"
                        autoComplete="organization"
                        placeholder={t("auth.signup.orgPlaceholder")}
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                        className="h-10 rounded-xl pl-9"
                      />
                    </div>
                    <p className="text-xs text-slate-400">{t("auth.signup.orgHint")}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reg-email">{t("auth.field.email")}</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        placeholder={t("auth.signup.emailPlaceholder")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-10 rounded-xl pl-9"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-password">{t("auth.field.password")}</Label>
                      <PasswordInput
                        id="reg-password"
                        autoComplete="new-password"
                        placeholder={t("auth.signup.passwordPlaceholder")}
                        value={password}
                        onChange={setPassword}
                        show={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-confirm">{t("auth.signup.confirm")}</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="reg-confirm"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder={t("auth.signup.confirmPlaceholder")}
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          className={cn(
                            "h-10 rounded-xl pl-9",
                            confirm && confirm !== password && "border-red-300 focus-visible:ring-red-200"
                          )}
                        />
                      </div>
                      {confirm && confirm !== password && (
                        <p className="text-xs font-medium text-red-600">{t("auth.error.mismatchLive")}</p>
                      )}
                    </div>
                  </div>

                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium text-slate-700">{t("auth.signup.roleLegend")}</legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {ROLE_OPTIONS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRole(value)}
                          aria-pressed={role === value}
                          className={cn(
                            "rounded-xl border p-3 text-left transition",
                            role === value
                              ? "border-teal-400 bg-teal-50/70 ring-1 ring-teal-300"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900">{t(`auth.role.label.${value}`)}</span>
                            {role === value && <BadgeCheck className="size-4 text-teal-600" />}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">{t(`auth.role.hint.${value}`)}</p>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  {formError && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      role="alert"
                      className="text-sm font-medium text-red-600"
                    >
                      {formError}
                    </motion.p>
                  )}

                  <Button
                    type="submit"
                    disabled={busy || (confirm.length > 0 && confirm !== password)}
                    className="h-10 w-full rounded-xl bg-teal-700 text-white shadow-sm hover:bg-teal-800"
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {busy ? t("auth.action.creatingAccount") : t("auth.action.signUp")}
                  </Button>
                  <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
                    <Users className="size-3.5" />
                    {t("auth.signup.footer")}
                  </p>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Password input with visibility toggle ───────────────────────────────────

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  show,
  onToggle,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  show: boolean;
  onToggle: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-xl pl-9 pr-10"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? t("auth.aria.hidePassword") : t("auth.aria.showPassword")}
        className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

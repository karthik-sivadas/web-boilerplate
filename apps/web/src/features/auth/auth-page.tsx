import { Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { authClient } from "./client";
import { notifySessionChange } from "./session-context";
import styles from "./auth.module.css";

function messageFor(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "We could not complete that request. Check your connection and try again.";
}

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const signUp = mode === "sign-up";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");
    setPending(true);
    setError("");
    try {
      const result = signUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        setError(messageFor(result.error));
        return;
      }
      notifySessionChange();
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <CardHeader className={styles.header}>
          <p className="text-sm text-muted-foreground">Workbench</p>
          <CardTitle className={styles.title}>
            {signUp ? "Create your account" : "Welcome back"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className={styles.form}
            onSubmit={(event) => void submit(event)}
            noValidate={false}
          >
            {signUp ? (
              <div className={styles.field}>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={1}
                  disabled={pending}
                />
              </div>
            ) : null}
            <div className={styles.field}>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={pending}
              />
            </div>
            <div className={styles.field}>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={signUp ? "new-password" : "current-password"}
                required
                minLength={8}
                disabled={pending}
              />
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" isDisabled={pending}>
              {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className={styles.note}>
            {signUp ? "Already have an account?" : "Need an account?"}{" "}
            <Link to={signUp ? "/sign-in" : "/sign-up"}>
              {signUp ? "Sign in" : "Sign up"}
            </Link>
          </p>
          {signUp ? (
            <p className={styles.note}>Email ownership is not verified yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

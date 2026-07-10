"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Card, Stack, Text, TextInput } from "@astryxdesign/core";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);
  const [password, setPassword] = useState("");

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-background-body)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <Card padding={6} width="100%" maxWidth={390} className="animate-scale-in">
        <form action={formAction}>
          <Stack direction="vertical" gap={6}>
            <Stack direction="vertical" gap={2}>
              <Text type="display-3" size="xl" display="block">
                Dealflow Agent
              </Text>
              <Text type="body" size="sm" color="secondary" display="block">
                Enter the password to continue.
              </Text>
            </Stack>

            <TextInput
              label="Password"
              isLabelHidden
              type="password"
              htmlName="password"
              value={password}
              onChange={setPassword}
              placeholder="Password"
              hasAutoFocus
              status={state?.error ? { type: "error", message: state.error } : undefined}
            />

            <Button
              type="submit"
              label={pending ? "Signing in…" : "Sign in"}
              variant="primary"
              isDisabled={pending}
              isLoading={pending}
              endContent={<ArrowRight size={16} />}
              style={{ width: "100%" }}
            />
          </Stack>
        </form>
      </Card>
    </main>
  );
}

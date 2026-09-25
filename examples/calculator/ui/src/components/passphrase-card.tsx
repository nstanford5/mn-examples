import { useState } from "react";
import { validatePassword } from "@midnight-ntwrk/midnight-js-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { useMidnightProviders } from "@/providers/midnight-providers";

/**
 * Unlocks the encrypted private-state store (PRIVATE_STATE_STORAGE =
 * "persistent"). App shows it instead of the panel while the store is locked.
 *
 * The first passphrase used with a wallet account in this browser becomes that
 * store's passphrase; later sessions must repeat it (a wrong one is caught by
 * persistentPrivateStateProvider's canary and reported here). It is validated
 * with the same policy the store enforces, so a weak one fails here with a
 * readable reason rather than on the first write.
 */
export function PassphraseCard() {
  const { unlock, unlockError } = useMidnightProviders();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unlock private state</CardTitle>
        <CardDescription>
          This app keeps your private state (secret keys, hidden values) encrypted in this
          browser. Enter the passphrase for it; the first one you use for a wallet account becomes
          that account&apos;s passphrase. It isn&apos;t stored anywhere, and there is no recovery:
          forgetting it, or clearing site data, loses the private state.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              validatePassword(value);
            } catch (err: unknown) {
              setInvalid(errorMessage(err, "Passphrase is too weak"));
              return;
            }
            setInvalid(null);
            unlock(value);
          }}
        >
          <div className="flex gap-2">
            <Input
              type="password"
              aria-label="Passphrase"
              autoComplete="current-password"
              placeholder="16+ characters, 3 of: upper, lower, digit, symbol"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit" disabled={value.length === 0}>
              Unlock
            </Button>
          </div>
          {(invalid ?? unlockError) && (
            <p className="text-sm text-destructive" role="alert">
              {invalid ?? unlockError}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

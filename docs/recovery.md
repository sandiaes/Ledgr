# Lockout recovery

The app's data requires **aal2**: password **and** an authenticator code
(`supabase/migrations/20261020000001_require_aal2.sql`). If you lose your authenticator,
the app shows no data and refuses all changes. **Your data is not lost**. It is only
hidden from sessions without MFA.

You can always recover as long as you can log in to the **Supabase Dashboard**
(supabase.com). The SQL Editor runs as the `postgres` role, which is not subject to RLS
or the aal2 rule. That makes the Supabase account the master key, so:

- Protect your supabase.com account with its own MFA and keep its recovery codes in a
  password manager.
- Keep at least one of: authenticator app backup/sync, or a copy of the TOTP secret in a
  password manager.

---

## Scenario 1: lost / reset phone, still have Dashboard access (normal case)

Goal: remove the old authenticator and enroll a new one. The aal2 rule **stays on** the
whole time, so your data is never exposed to a password-only session.

1. Log in to the Supabase Dashboard and open the project.
2. Remove the TOTP factor, either:
   - **Dashboard:** Authentication → Users → click your user → delete the TOTP / MFA
     factor (if your dashboard version shows this option), or
   - **SQL Editor** (replace the email):

     ```sql
     -- See what will be removed
     select f.id, f.friendly_name, f.factor_type, f.status, f.created_at
     from auth.mfa_factors f
     join auth.users u on u.id = f.user_id
     where u.email = 'you@example.com';

     -- Remove the TOTP factor(s)
     delete from auth.mfa_factors
     where user_id = (select id from auth.users where email = 'you@example.com')
       and factor_type = 'totp';
     ```

3. **Optional, if a device signed in to the app was lost or stolen:** sign out every
   session for your user:

   ```sql
   delete from auth.sessions
   where user_id = (select id from auth.users where email = 'you@example.com');
   ```

4. Start the desktop app (`pnpm --filter @ledgr/desktop dev`), sign in with your
   password. It offers **Enroll authenticator (TOTP)** again. Scan, save the secret
   in your password manager this time, enter the code: you are back at aal2 and your
   data is visible.

## Scenario 2: emergency, need data access before you can re-enroll

Only if Scenario 1 is not possible right now. This **turns MFA off for the data**:
anyone with your password can then read and write it. Owner isolation stays in place.

1. Dashboard → SQL Editor → paste and run `supabase/recovery/disable_aal2.sql`.
   The final query lists the remaining policies; none should be named `*_require_aal2`.
2. Do what you need. To get MFA back you still have to remove the old factor and
   enroll a new one (Scenario 1, steps 2 and 4): while the old verified factor exists,
   the app asks for its code instead of offering enrollment.
3. **Turn MFA back on:** SQL Editor → paste and run
   `supabase/recovery/enable_aal2.sql`. It recreates the policy on every table (the
   aal2 migration alone does not cover tables added by later migrations) and is safe
   to run more than once.
4. Verify: run `supabase/tests/rls_aal2.sql` in the SQL Editor. It must end with
   `aal2 enforcement: ALL CHECKS PASSED`.

> Running SQL in the editor does not touch the CLI's migration history, so
> `supabase db push` still considers the aal2 migrations applied. That is why step 3
> restores the policies by hand.

## Scenario 3: lost access to the Supabase account too

The app cannot help here: neither the password nor the authenticator gives access to
data without aal2, and only the Supabase account can lift that. Use supabase.com's
account recovery (password reset, account MFA recovery codes, or Supabase support).
This is why the supabase.com account needs its own backup MFA.

## If the SQL Editor refuses to modify `auth.*` tables

Supabase has been tightening what the `postgres` role may change in the `auth` schema.
If a `delete from auth.mfa_factors` is refused, use the Dashboard user page (Scenario 1,
step 2). If neither works, Scenario 2 still restores access to your data (it only
changes `public` policies), and Supabase support can remove the factor.

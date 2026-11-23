# The student area

The student area at **primemathstutoring.co.uk/portal** runs on **Supabase**, a free service that handles logins, the database, file storage and the emails. Until it's connected, the page shows "Coming soon", so nothing breaks while it's set up.

**Done already:** the project **prime-maths-tutoring** (London) is set up with everything below, apart from the email account in step 8. The website is connected.

## What it does

**Students**
- **Homework**, sorted into **To do**, **Handed in** and **Marked**. Each piece shows when it's due ("Due in 3 days", "Due tomorrow", "Missing"), the worksheet, and any questions to mark themselves.
- **Handing in**: PDFs or photos, a note for the tutor, and their self-mark score. They can add more files (for example, photos of their marking) or remove a wrong one until it's marked.
- **Marks and feedback**: their own marking, the tutor's marking and the total.
- **Comments** under each piece of homework, and a **Messages** tab for talking to their tutor, with photos and files.
- **Resources**: slides, notes and the full guides.
- **The bell** at the top: everything new, in one list.
- **Settings**: which emails they get, and their password.

**Tutors and admins**
- **Homework**: set it (with a worksheet, self-marking and answers), see who has handed in, mark it, change a due date, and comment on each student's work.
- **To mark**: everything handed in and waiting, oldest first, with the mark form right there.
- **Messages**: every student's conversation, with unread counts.
- **Students**: name, subjects, their tutor, a parent or guardian to email updates to, and private tutor notes that students never see.
- **Resources** and **Settings**.

**Emails and notifications** (everyone can turn each kind off in Settings)

| When | Who hears |
|---|---|
| Homework is set | The student (and their parent, if turned on) |
| 7 days, 3 days and 1 day before it's due, if not handed in | The student (parents get the 3 day and 1 day ones) |
| The day after it was due, if it's still missing | The student, their parent and their tutor |
| It's handed in | Their tutor |
| It's marked | The student and their parent, with the mark |
| A message or comment is sent | The other side (never parents) |

Each person gets at most one email every couple of minutes, listing everything new, with a button straight to it. Several messages in a row are grouped into one notice. Reminders go out at about 4pm UK time.

"Their tutor" is the tutor chosen for them in the Students tab. If none is chosen, whoever set the homework hears; otherwise every admin.

## How it's built

| File | What it is |
|---|---|
| `schema.sql` | Part 1: people, homework, hand-ins, self-marking, resources, private file storage, and the security rules |
| `messages-and-notifications.sql` | Part 2: tutors and parents, messages, notifications, email settings, tutor notes and due date reminders |
| `functions/send-emails/index.ts` | The email sender (a Supabase Edge Function) |
| `email-schedule.sql` | Part 3: runs the email sender every couple of minutes, and the reminders every day |

The security rules mean each student only ever sees their own homework, work, messages and notifications. Students can't mark their own work, change a mark, or read anyone else's conversation, and only tutors can read tutor notes.

## Setting it up from scratch

You only need this if you ever start a new Supabase project. Everything is already done on the current one.

1. **Create the project.** At supabase.com, click **New project**: name `prime-maths-tutoring`, region **London**, plan **Free**.
2. **Add the database.** In **SQL Editor**, run `schema.sql`, then `messages-and-notifications.sql`.
3. **Turn off public sign-ups.** **Authentication**, then **Sign In / Providers**: turn off "Allow new users to sign up".
4. **Point emails back to the website.** **Authentication**, then **URL Configuration**: set the Site URL to `https://www.primemathstutoring.co.uk/portal`, and add the same address under Redirect URLs.
5. **Make your own account.** **Authentication**, then **Users**, then **Add user**: your email, a password, and tick **Auto Confirm User**. Then run this in the SQL Editor:

   ```sql
   update public.profiles set role = 'admin', full_name = 'Harmaan Gill' where email = 'your.email@example.com';
   ```

6. **Connect the website.** From **Project Settings**, then **API Keys**, copy the Project URL and the **publishable** key (`sb_publishable_...`) into the top of `portal.js`. Both are safe to publish. Never share a **secret** key.
7. **Add the email sender.** Deploy `functions/send-emails` as an Edge Function called `send-emails`, with "Verify JWT" turned **off** (it checks its own password instead). Then put your project's address into `email-schedule.sql` and run it.
8. **Connect an email account** (below).

## Step 8: connect an email account (to do)

Notifications already show under the bell. To also send them as emails, the student area needs an account with **Resend** (resend.com), which sends emails for websites. The free plan covers 3,000 emails a month and 100 a day.

1. **Sign up** at resend.com.
2. **Add your domain.** In Resend, open **Domains**, then **Add domain**, and enter `primemathstutoring.co.uk`. Region: **Ireland (eu-west-1)**.
3. **Add Resend's records in Namecheap.** Resend shows three or four DNS records (a DKIM record called `resend._domainkey`, plus an MX and a TXT record on `send`). In Namecheap, go to **Domain List**, then **Manage**, then **Advanced DNS**, and add each one exactly as shown. They don't touch your website or your hello@ forwarding.
4. Back in Resend, click **Verify**. It can take a few minutes, sometimes up to a few hours.
5. **Create an API key.** In Resend, open **API Keys**, then **Create API key**, with **Sending access** only.
6. **Give it to Supabase.** In Supabase, open **Edge Functions**, then **Secrets**, and add a secret named `RESEND_API_KEY` with the key as its value. (Or ask Claude to set it up: Supabase will ask you to type the key into its own page, so it never passes through the chat.)

Emails come from `notifications@primemathstutoring.co.uk`, and replies go to `hello@primemathstutoring.co.uk`.

**Password reset emails can use the same account.** In Supabase, open **Authentication**, then **Emails**, then **SMTP Settings**, turn on custom SMTP and enter:

| Setting | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | `notifications@primemathstutoring.co.uk` |
| Sender name | `Prime Maths Tutoring` |

Until then, reset a student's password yourself by running this in the SQL Editor:

```sql
update auth.users
set encrypted_password = extensions.crypt('NewTempPassword1', extensions.gen_salt('bf'))
where email = 'student@example.com';
```

## Adding a student after their intro call

1. **Authentication**, then **Users**, then **Add user**, then **Create new user**: their email, a temporary password, and tick **Auto Confirm User**.
2. In the tutor area, open **Students** and refresh. Add their name, subjects and tutor, and a parent's email if they'd like updates. Then save.
3. Give them the temporary password. They can change it in **Settings** once they've logged in.

To add another tutor, create their account the same way, then change their role to **Tutor** in the Students tab.

## Good to know

- **Free plan limits:** 1 GB of files, 50 MB per file, 500,000 Edge Function calls a month, which is plenty. Free projects pause after a week with no activity at all. If that happens, open the project in Supabase and click **Restore**.
- **Checking emails:** in the SQL Editor, `select title, email_status, emailed_at from notifications order by created_at desc limit 20;` shows what was sent. `sent` means delivered to Resend; `off` means that person turned that kind of email off; `not_configured` means there was no Resend key yet.
- **Data protection:** the student area stores students' names, emails, homework, messages and parents' emails. Add a privacy notice before you start using it with families.

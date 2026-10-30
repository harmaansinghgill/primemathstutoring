# Setting up the student area

The student area at **primemathstutoring.co.uk/portal** runs on **Supabase**, a free service that handles logins, the database and file storage. Until it's connected, the page shows "Coming soon", so nothing breaks while you set it up.

**Done already:** the project **prime-maths-tutoring** (London) exists, steps 1, 2 and 6 are complete, and the website is connected. Only steps 3, 4 and 5 are left.

It takes about 20 minutes. You only do this once.

**Quicker option:** make a free Supabase account (sign in with GitHub), then connect the **Supabase connector** in Claude (claude.ai, Settings, Connectors). That lets Claude create the project, add the database and security rules, and fetch the two website keys for you, without you sharing any password. You then only need to do steps 3, 4 and 5 below yourself (a few switches, and making your own login, so your password stays with you).

## 1. Create the Supabase project

1. Go to **supabase.com** and sign up. Signing in with your GitHub account is quickest.
2. Click **New project**.
   - **Name:** `prime-maths-tutoring`
   - **Database password:** click *Generate a password* and save it somewhere safe. You won't need it day to day.
   - **Region:** choose **London** (so data stays in the UK).
   - **Plan:** Free.
3. Wait a minute or two while it sets up.

## 2. Add the database and security rules

1. In the left menu, open **SQL Editor**, then **New query**.
2. Open `portal-setup/schema.sql` from this repository, copy everything, paste it in and click **Run**.
3. It should say **Success. No rows returned**.

This creates the tables for students, homework, hand-ins and resources, the private file storage, and the rules that make sure each student can only ever see their own work.

## 3. Turn off public sign-ups

1. Open **Authentication**, then **Sign In / Providers**.
2. Turn **off** "Allow new users to sign up" and save.

Now the only way to get an account is for you to create one.

## 4. Point emails back to the website

1. Open **Authentication**, then **URL Configuration**.
2. Set **Site URL** to `https://www.primemathstutoring.co.uk/portal`.
3. Under **Redirect URLs**, add `https://www.primemathstutoring.co.uk/portal`.

## 5. Make your own account (as admin)

1. Open **Authentication**, then **Users**, then **Add user**, then **Create new user**.
2. Enter your email and a password, tick **Auto Confirm User**, and create it.
3. Open **SQL Editor**, then **New query**, paste this (with your email) and click **Run**:

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Harmaan Gill'
   where email = 'your.email@example.com';
   ```

To add another tutor later, create their account the same way, then change their role to **Tutor** in the Students tab of the tutor area.

## 6. Connect the website

1. Open **Project Settings**, then **API** (sometimes shown as **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Send both to Claude, or paste them into the top of `portal.js` in place of `PASTE-YOUR-SUPABASE-URL` and `PASTE-YOUR-SUPABASE-ANON-KEY`.

Both values are designed to be public. The security rules from step 2 decide what each person can see. **Never** share the `service_role` key: that one bypasses the rules.

## 7. Try it

Go to **primemathstutoring.co.uk/portal** and log in. You'll see the tutor area with three tabs:

- **Homework:** set homework for a subject, with an optional worksheet, for some or all of the students taking it. Open any piece of homework to see who has handed in, download their work, and give a mark and feedback.
- **Self-marking:** when setting homework, fill in **Questions they mark themselves** (for example "Questions 1 to 5"). You can then type the answers, upload a mark scheme, or both, and choose whether students see them **straight away** or **once they've handed in**. Students mark those questions in a different colour pen, upload their work and enter their score. When you mark it, you check their self-mark (and correct it if needed), add your mark for the rest, and the student sees both marks and the total.
- **Students:** set each student's name and subjects. Subjects decide which tabs, homework and resources they see.
- **Resources:** share slides, notes and the full guides, either with everyone taking a subject, with all students, or with one student only.

## Adding a student after their intro call

1. **Authentication → Users → Add user → Create new user**: their email, a temporary password, and tick **Auto Confirm User**.
2. In the tutor area, open **Students**, refresh, and add their name and subjects. Then save.
3. Give them the temporary password. They can change it with the **Password** button once they've logged in.

## Good to know

- **Free plan limits:** 1 GB of files, 50 MB per file and up to 50,000 active users a month, which is plenty. Free projects pause after a week with no activity at all; if that happens, open the project in Supabase and click **Restore**.
- **Password reset emails:** Supabase's built-in email sender is only meant for testing and may not reach students. Until you set up your own email sending (**Authentication → Emails → SMTP Settings**, for example with a free Resend or Brevo account), reset a student's password yourself by running this in the SQL Editor:

  ```sql
  update auth.users
  set encrypted_password = extensions.crypt('NewTempPassword1', extensions.gen_salt('bf'))
  where email = 'student@example.com';
  ```

- **The full guides:** upload the four guide PDFs in the **Resources** tab. Choose **All subjects**, or the matching subject, so the right students can download them.
- **Data protection:** the student area stores students' names, emails and homework. Add a privacy notice before you start using it with families.

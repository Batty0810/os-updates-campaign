# OS Updates Campaign

**Live app:** https://batty0810.github.io/os-updates-campaign/

Small web app for tracking customer contact during the VM OS-updates campaign.
Account managers book a meeting with each customer and a Nymbis attendee (Sean Rose, Daniel Martins, Jimmy Mokwena, Jose van der Merwe or Brendon Atwell), tick it off when held and record a comment. The dashboard shows customers, meetings scheduled/completed and success rate per account manager; everything exports to Excel.

Anyone can view. Editing requires a Nymbis account (created by an admin in Supabase; public sign-up is disabled).

- **Frontend:** built with the Nymbis Design System (Nymbis brand 9: Encode Sans Semi Expanded, #420A38 / #9D0081 / #FF1A40)
- **Database:** Supabase (Postgres) — schema in `supabase/migrations/`

> Customer data is loaded directly into Supabase and is never committed to this repository.

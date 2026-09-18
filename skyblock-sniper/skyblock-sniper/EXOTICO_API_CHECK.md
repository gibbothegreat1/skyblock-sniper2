# Exotico Check Me integration

The Check Me route now calls Exotico's JSON endpoint directly instead of rendering/scraping the website.

## Vercel environment variable

Add this variable in Vercel Project Settings -> Environment Variables:

- `EXOTICO_LOAD_TOKEN` = the current value of the `x-load-token` request header used by Exotico.

Do not commit the token to GitHub.

After adding/changing it, redeploy the production deployment.

The route compares every requested piece using:

1. Exotico `exoticItems[].name` (item ID)
2. Exotico `exoticItems[].color` (exact six-digit hex)

All profiles returned by Exotico are checked. Fairy/Crystal items are also present in `exoticItems`, so Check Me works for those when they are displayed by the site.

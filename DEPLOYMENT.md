# GitHub Pages

The `.github/workflows/pages.yml` workflow builds and publishes the app after a
push to `main`, or when manually run from the Actions tab.

In the repository settings, select **Pages → Build and deployment → Source →
GitHub Actions** before the first deployment. The workflow reads the Pages base
path automatically, so project sites and user sites use the correct asset URLs.

The published directory is `dist/live-keys/browser`. Sample banks and their
attribution files are included; `sample-source`, local caches and test artifacts
are excluded from Git. No GitHub token belongs in the source tree: deployment
uses the workflow's short-lived `GITHUB_TOKEN`.

Local check for a project site:

```sh
npm ci
npm test
npm run samples:verify
npm run build -- --base-href /live-keys/
```

After publication, enable audio in the browser and test every sample bank. MIDI
and audio output still need checking with the physical keyboard and speakers.
Local presets from localhost do not automatically transfer to the Pages origin;
use JSON export/import to transfer them.

Reference: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

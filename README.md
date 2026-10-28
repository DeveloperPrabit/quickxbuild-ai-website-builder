# quickxbuild-ai-website-builder

# QuickXBuild

**AI website builder powered by Meta Muse Spark**

Describe a business in plain language → Muse agents generate a real React app → live sandbox preview in the IDE → iterate by chat.

Live demo: [websitebuilder.techspireglobal.com](https://websitebuilder.techspireglobal.com)

## Meta Global AI Developer Hackathon (Indie)

- **Track:** Indie developer
- **Theme:** Build for Your World
- **Meta product:** Muse Spark via Meta Model API (`api.meta.ai`) as the primary coding agent
- **Builder:** Prabit Joshi (team: Prabits)

### What this project does

QuickXBuild turns natural-language prompts into multi-page Vite + React sites (booking, About, Contact, etc.), syncs files into an E2B sandbox, and shows a working preview inside the builder UI.

### Stack (high level)

- Next.js 15 app shell + tRPC API
- Meta Muse Spark agent loop (tool use: list / search / read / write / patch)
- E2B sandboxes for live Vite preview
- Neon Postgres + Docker/VPS deploy path

### Local development

```bash
bun install
cp .env.example .env   # add MODEL_API_KEY (Muse) and other secrets locally — never commit .env
bun run dev:web
```

### License

See [LICENSE](./LICENSE).

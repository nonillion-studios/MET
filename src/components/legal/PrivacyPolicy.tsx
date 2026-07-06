export function PrivacyPolicy() {
  return (
    <div className="space-y-4 text-sm text-ink-muted leading-relaxed">
      <p className="text-[11px] font-mono uppercase tracking-widest text-accent">Template — replace with your own policy</p>
      <p className="text-[11px] text-ink-faint">Last updated: [Placeholder Date]</p>

      <section className="space-y-1.5">
        <h3 className="text-ink font-semibold">1. Information We Collect</h3>
        <p>MET stores your library data (series, volumes, chapters, and uploaded page images) locally in your browser using IndexedDB. No account or personal information is required to use the app.</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-ink font-semibold">2. How We Use Local Storage</h3>
        <p>Preferences such as theme mode and settings toggles are saved in your browser's local storage so they persist between sessions. This data never leaves your device unless you explicitly export or sync it.</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-ink font-semibold">3. Third-Party Services</h3>
        <p>[Placeholder] If you connect optional third-party services (e.g., cloud backup), those services have their own privacy practices. Review their policies before enabling them.</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-ink font-semibold">4. Advertising</h3>
        <p>[Placeholder] This app may display ad placeholders. Replace this section with details about any ad network you integrate and what data it collects.</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-ink font-semibold">5. Your Choices</h3>
        <p>You can clear all locally stored data at any time from System Settings.</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-ink font-semibold">6. Contact</h3>
        <p>[Placeholder contact email or form link]</p>
      </section>
    </div>
  );
}

# Upstream source dependencies

`dsh-next/` contains the complete DSH Next source checkout, pinned by the parent Git repository to commit `f2483c6d26104b3594cb0e22f56c0331b55dfffe` from `https://github.com/xue-ding-e/DSH-Next.git`. The upstream MIT license and notices remain in that checkout.

Clone Somnus with submodules:

```powershell
git clone --recurse-submodules https://github.com/GSXTY/Somnus.git SomnusNext
```

For an existing clone:

```powershell
git submodule update --init --recursive
```

Somnus-specific source adaptations live outside this dependency in `desktop/dsh_next/`. Keep the upstream checkout at the recorded commit; record an upstream update and its compatibility checks in a separate PR. Do not point the submodule at an uncommitted change or a commit unavailable from its public remote.

The previous `desktop/dsh_next/upstream/app.asar` is the release-based build input. Its presence is not evidence that source compilation has succeeded; source-build validation must use this checkout and report its actual result.

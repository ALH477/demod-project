{
  description = "DEMOD — Chromatic Tuner. Demodulate the signal. Find the note.";

  inputs = {
    nixpkgs.url      = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url  = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # ── runtime deps ──────────────────────────────────────────────────────
        # PipeWire support: pw-record lives in pipewire.
        # ALSA fallback:    arecord lives in alsa-utils.
        # The launcher script also optionally uses various terminal emulators,
        # but those are user-environment deps — not hard-wired here.
        runtimeDeps = with pkgs; [
          pipewire   # pw-record
          alsa-utils # arecord (fallback)
        ];

        # ── build the bun bundle ──────────────────────────────────────────────
        demodBundle = pkgs.stdenvNoCC.mkDerivation {
          pname   = "demod-bundle";
          version = self.shortRev or "dev";

          src = ./src;

          nativeBuildInputs = [ pkgs.bun ];

          buildPhase = ''
            # Bundle demod.ts into a single self-contained JS file.
            # --target bun keeps Bun-native APIs (spawn etc.) intact.
            bun build demod.ts \
              --target bun \
              --outfile demod.js \
              --minify
          '';

          installPhase = ''
            mkdir -p $out
            cp demod.js $out/
          '';
        };

        # ── wrapper script: `demod` binary ───────────────────────────────────
        demodScript = pkgs.writeShellScript "demod" ''
          export PATH="${pkgs.lib.makeBinPath runtimeDeps}:$PATH"
          exec ${pkgs.bun}/bin/bun run ${demodBundle}/demod.js "$@"
        '';

        # ── desktop launcher (substitutes @demod_bin@ placeholder) ───────────
        launchScript = pkgs.stdenvNoCC.mkDerivation {
          pname = "demod-launch";
          version = self.shortRev or "dev";
          src = ./desktop/demod-launch.sh;
          dontUnpack = true;
          installPhase = ''
            mkdir -p $out
            substitute $src $out/demod-launch.sh \
              --replace-fail "@demod_bin@" "${demodScript}"
            chmod +x $out/demod-launch.sh
          '';
        };

        # ── icon (SVG → multi-res PNG via rsvg-convert) ────────────────────
        icons = pkgs.stdenvNoCC.mkDerivation {
          pname = "demod-icons";
          version = self.shortRev or "dev";
          src = ./assets;
          nativeBuildInputs = [ pkgs.librsvg ];
          buildPhase = ''
            for size in 16 22 24 32 48 64 128 256 512; do
              mkdir -p icons/hicolor/''${size}x''${size}/apps
              rsvg-convert -w $size -h $size demod.svg \
                -o icons/hicolor/''${size}x''${size}/apps/demod.png
            done
            mkdir -p icons/hicolor/scalable/apps
            cp demod.svg icons/hicolor/scalable/apps/demod.svg
          '';
          installPhase = ''
            mkdir -p $out/share
            cp -r icons $out/share/
          '';
        };

        # ── main package ──────────────────────────────────────────────────────
        demod = pkgs.stdenvNoCC.mkDerivation {
          pname   = "demod";
          version = self.shortRev or "0.1.0";

          # No source to build — everything is already in the above derivations
          dontUnpack = true;
          dontBuild  = true;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            # ── binaries ──────────────────────────────────────────────────────
            mkdir -p $out/bin

            # Main TUI entry point
            cp ${demodScript} $out/bin/demod
            chmod +x $out/bin/demod

            # Desktop launcher (opens a terminal window)
            cp ${launchScript}/demod-launch.sh $out/bin/demod-desktop
            chmod +x $out/bin/demod-desktop
            # Patch shebang + inject PATH with runtimeDeps
            wrapProgram $out/bin/demod-desktop \
              --prefix PATH : "${pkgs.lib.makeBinPath runtimeDeps}"

            # ── desktop integration ───────────────────────────────────────────
            mkdir -p $out/share/applications
            substitute ${./desktop/demod.desktop} $out/share/applications/demod.desktop \
              --replace "Exec=demod" "Exec=$out/bin/demod-desktop"

            # ── icons ─────────────────────────────────────────────────────────
            cp -r ${icons}/share/icons $out/share/
          '';

          meta = with pkgs.lib; {
            description  = "DEMOD — Chromatic Tuner. Demodulate the signal. Find the note.";
            longDescription = ''
              A full-featured chromatic tuner with a rich TUI interface.
              Supports PipeWire (pw-record), ALSA (arecord), and CoreAudio (sox).
              Features: device selection overlay, 4 visual palettes (PHOSPHOR /
              CINDER / PLASMA / ARCTIC), arc needle, spectrum waterfall, VU meter,
              cents history sparkline, and 7-row pixel-art note glyphs.
            '';
            homepage     = "https://github.com/ALH477/demod";
            license      = licenses.bsd3;
            platforms    = platforms.linux ++ platforms.darwin;
            mainProgram  = "demod";
          };
        };

      in {
        # ── outputs ───────────────────────────────────────────────────────────
        packages = {
          inherit demod;
          default = demod;
        };

        # `nix run` → launches the desktop wrapper
        apps = {
          demod = flake-utils.lib.mkApp {
            drv  = demod;
            name = "demod-desktop";
          };
          default = flake-utils.lib.mkApp {
            drv  = demod;
            name = "demod-desktop";
          };
          # `nix run .#tui` → raw TUI, no terminal wrapper
          tui = flake-utils.lib.mkApp {
            drv  = demod;
            name = "demod";
          };
        };

        # `nix develop` → shell with bun + audio tools + common terminals
        devShells.default = pkgs.mkShell {
          name = "demod-dev";
          packages = with pkgs; [
            bun
            pipewire
            alsa-utils
            # nice-to-have terminal emulators for testing the launcher
            foot
            kitty
            # dev tools
            nodePackages.typescript-language-server
          ];
          shellHook = ''
            echo ""
            echo "  ██████╗ ███████╗███╗   ███╗ ██████╗ ██████╗ "
            echo "  ██╔══██╗██╔════╝████╗ ████║██╔═══██╗██╔══██╗"
            echo "  ██║  ██║█████╗  ██╔████╔██║██║   ██║██║  ██║"
            echo "  ██║  ██║██╔══╝  ██║╚██╔╝██║██║   ██║██║  ██║"
            echo "  ██████╔╝███████╗██║ ╚═╝ ██║╚██████╔╝██████╔╝"
            echo "  ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ "
            echo ""
            echo "  dev shell — bun $(bun --version)"
            echo ""
            echo "  bun run src/demod.ts   — run directly"
            echo "  nix build              — build package"
            echo "  nix run                — desktop launcher"
            echo "  nix run .#tui          — raw TUI"
            echo ""
          '';
        };

        # NixOS module for system-wide installation
        nixosModules.default = { config, lib, pkgs, ... }:
          let
            cfg = config.programs.demod;
          in {
            options.programs.demod = {
              enable = lib.mkEnableOption "DEMOD chromatic tuner";
            };

            config = lib.mkIf cfg.enable {
              environment.systemPackages = [ demod ];
              # Ensure PipeWire is available (most NixOS systems already have it)
              hardware.pulseaudio.enable = lib.mkDefault false;
              services.pipewire = {
                enable      = lib.mkDefault true;
                alsa.enable = lib.mkDefault true;
                pulse.enable = lib.mkDefault true;
              };
            };
          };
      }
    );
}

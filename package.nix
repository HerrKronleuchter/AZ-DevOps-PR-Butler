# Note: Taken and adapted from <https://github.com/NixOS/nixpkgs/blob/nixos-unstable/pkgs/desktops/gnome/extensions/buildGnomeExtension.nix>.
{
  pkgs,
  lib,
  stdenv,
}:
let
  metadata = builtins.fromJSON (builtins.readFile ./metadata.json);
  buildGnomeExtension = stdenv.mkDerivation {
    pname = "gnome-shell-extension-${metadata.name}";
    inherit (metadata) version;
    src = ./.;
    nativeBuildInputs = with pkgs; [ buildPackages.glib ];
    buildPhase = ''
      runHook preBuild
      if [ -d schemas ]; then
        glib-compile-schemas --strict schemas
      fi
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p $out/share/gnome-shell/extensions/
      cp -r -T . $out/share/gnome-shell/extensions/${metadata.uuid}
      runHook postInstall
    '';
    meta = {
      description = builtins.head (lib.splitString "\n" metadata.description);
      longDescription = metadata.description;
      license = lib.licenses.gpl2Plus;
      platforms = lib.platforms.linux;
      maintainers = [
        "@HerrKronleuchter"
        "@duesee"
      ];
    };
    passthru = {
      extensionPortalSlug = metadata.name;
      extensionUuid = metadata.uuid;
    };
  };
in
lib.makeOverridable buildGnomeExtension

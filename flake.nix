{
  description = "PR-Butler";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixpkgs-unstable/nixexprs.tar.zst";
  };

  outputs = inputs: {
    formatter = builtins.mapAttrs (_system: pkgs: pkgs.nixfmt-tree) inputs.nixpkgs.legacyPackages;

    packages = builtins.mapAttrs (_system: pkgs: {
      default = pkgs.callPackage ./package.nix { };
    }) inputs.nixpkgs.legacyPackages;

    overlays.default = import ./overlay.nix;
  };
}

final: prev: {
  gnomeExtensions = prev.gnomeExtensions // {
    az-devops-pr-butler = final.callPackage ./package.nix { };
  };
}

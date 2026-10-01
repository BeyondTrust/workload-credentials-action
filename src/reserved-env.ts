/**
 * Environment variable names that must never be derived from a secret's field keys.
 *
 * In export-all and prefix modes the output (and therefore env var) name comes from the
 * secret payload, so anyone who can name a field on a consumed secret would otherwise
 * choose the env var name on the consumer's runner. A name is listed here when setting it
 * (a) causes code to be loaded or executed, (b) relocates where a tool looks for config,
 * binaries, or certificates, or (c) weakens transport security.
 *
 * Credential-shaped names the action exists to deliver — AWS_ACCESS_KEY_ID, ARM_CLIENT_SECRET,
 * TF_VAR_*, DOCKER_PASSWORD, NPM_TOKEN — are deliberately absent. Where a credential does live
 * inside a reserved namespace (YARN_NPM_AUTH_TOKEN, say), the workflow can still ask for it by
 * name with `key` + `output-name`, which is a choice the author makes rather than the payload.
 */

const RESERVED_ENV_NAMES = new Set([
  // 1. Direct code execution hooks
  'AR',
  'AS',
  'BASHOPTS',
  'BASH_ENV',
  'BROWSER',
  'CC',
  'CFLAGS',
  'COMSPEC',
  'CPPFLAGS',
  'CXX',
  'CXXFLAGS',
  'EDITOR',
  'ENV',
  'GOFLAGS',
  'LD',
  'LDFLAGS',
  'LESSCLOSE',
  'LESSOPEN',
  'MAKEFLAGS',
  'MANPAGER',
  'MFLAGS',
  'PAGER',
  'PROMPT_COMMAND',
  'PS1',
  'PS4',
  'RANLIB',
  'RUBYOPT',
  'SHELL',
  'SHELLOPTS',
  'VISUAL',
  // 2. Loader, libc, and terminal database injection
  'GCONV_PATH',
  'GLIBC_TUNABLES',
  'HOSTALIASES',
  'LOCPATH',
  'NLSPATH',
  'RESOLV_HOST_CONF',
  'TERMCAP',
  'TZDIR',
  // 3. Search paths and identity relocation
  'ALLUSERSPROFILE',
  'APPDATA',
  'CDPATH',
  'CLASSPATH',
  'CONDA_PREFIX',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'IFS',
  'LIBRARY_PATH',
  'LOCALAPPDATA',
  'LOGNAME',
  'M2_HOME',
  'PATH',
  'PATHEXT',
  'PHPRC',
  'PHP_INI_SCAN_DIR',
  'PROGRAMDATA',
  'PSEXECUTIONPOLICYPREFERENCE',
  'PSMODULEPATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'VIRTUAL_ENV',
  'WINDIR',
  // Go toolchain: "GO" is too broad a prefix (GOOGLE_*), so these are enumerated.
  'GOBIN',
  'GOCACHE',
  'GOENV',
  'GOINSECURE',
  'GOMODCACHE',
  'GONOSUMCHECK',
  'GONOSUMDB',
  'GOPATH',
  'GOPRIVATE',
  'GOPROXY',
  'GOROOT',
  'GOSUMDB',
  'GOTOOLCHAIN',
  // 3b. Windows: install roots, toolchain discovery, and shell layers.
  // Windows treats env var names case-insensitively, so ComSpec/Path/windir arrive here
  // uppercased and match the same entries their Unix counterparts do.
  '__COMPAT_LAYER',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMW6432',
  'CYGWIN',
  'DEVENVDIR',
  'PROGRAMFILES',
  'PROGRAMW6432',
  'SCOOP',
  'SCOOP_GLOBAL',
  'VCINSTALLDIR',
  'VCTARGETSPATH',
  'VSINSTALLDIR',
  'WSLENV',
  // 4. Package manager redirection
  'GEM_SOURCE',
  'GRADLE_HOME',
  'MAVEN_CONFIG',
  'RUBYGEMS_HOST',
  'TF_PLUGIN_CACHE_DIR',
  // 6. Transport security and traffic redirection
  'ALL_PROXY',
  'CURL_CA_BUNDLE',
  'CURL_HOME',
  'FTP_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NETRC',
  'NO_PROXY',
  'REQUESTS_CA_BUNDLE',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'WGETRC',
  // 7. Cloud and container credential/endpoint hijack.
  // Namespaced by exact name: AWS_*, AZURE_*, ARM_* also carry the credentials this
  // action exists to deliver, so only the redirection members are reserved.
  'AWS_CA_BUNDLE',
  'AWS_CONFIG_FILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_PROFILE',
  'AWS_ROLE_ARN',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AZURE_AUTHORITY_HOST',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_CONFIG_DIR',
  'AZURE_FEDERATED_TOKEN_FILE',
  'ARM_CLIENT_CERTIFICATE_PATH',
  'IDENTITY_ENDPOINT',
  'IDENTITY_HEADER',
  'IMDS_ENDPOINT',
  'MSI_ENDPOINT',
  'MSI_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CONTAINERD_ADDRESS',
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
  'DOCKER_CONTENT_TRUST',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'KUBECONFIG',
]);

const RESERVED_ENV_PREFIXES = [
  // 1. Code execution hooks
  'BASH_FUNC_',
  'CGO_',
  'COR_', // .NET Framework profiler injection
  'CORECLR_', // .NET Core profiler injection
  'DOTNET_', // DOTNET_STARTUP_HOOKS, DOTNET_ADDITIONAL_DEPS, DOTNET_ROOT
  'JAVA_', // JAVA_TOOL_OPTIONS, JAVA_OPTS, JAVA_HOME
  'JDK_',
  '_JAVA',
  'NODE_', // NODE_OPTIONS (--require), NODE_PATH, NODE_TLS_REJECT_UNAUTHORIZED
  'PERL', // PERL5OPT (-M), PERL5DB, PERL5LIB
  'PYTHON', // PYTHONSTARTUP, PYTHONPATH, PYTHONBREAKPOINT, PYTHONHTTPSVERIFY
  'RUBY', // RUBYOPT (-r), RUBYLIB
  'RUSTC', // RUSTC, RUSTC_WRAPPER, RUSTC_WORKSPACE_WRAPPER
  // 2. Dynamic linkers and allocator tracing
  'DYLD_',
  'LD_',
  'MALLOC_',
  'TERMINFO',
  // 3. Search paths
  'XDG_',
  // 3b. Windows toolchain and package manager roots
  'CHOCOLATEY', // ChocolateyInstall, ChocolateyToolsLocation: relocates an executable tree
  'MSBUILD', // MSBuildUserExtensionsPath auto-imports .targets files, which run MSBuild tasks
  'MSYS', // MSYS, MSYSTEM, MSYS2_ARG_CONV_EXCL: Git for Windows / MSYS2 argument handling
  // 4. Package manager redirection. CARGO_ is split so CARGO_REGISTRY_TOKEN stays available.
  'BUNDLE_',
  'CARGO_BUILD_',
  'CARGO_HTTP_',
  'CARGO_HOME',
  'CARGO_NET_',
  'CARGO_REGISTRIES_',
  'CARGO_TARGET_',
  'CARGO_UNSTABLE_',
  'COREPACK_',
  'GEM_',
  'GRADLE_', // GRADLE_OPTS, GRADLE_USER_HOME. ORG_GRADLE_PROJECT_* is untouched.
  'MAVEN_',
  'NPM_CONFIG_',
  'NUGET_',
  'PIP_',
  'PNPM_',
  'POETRY_',
  'RUSTUP_',
  'TF_CLI_', // TF_CLI_CONFIG_FILE, TF_CLI_ARGS. TF_VAR_* is untouched.
  'UV_',
  'YARN_',
  // 5. Git, SSH, and sudo command hooks
  'GIT_', // GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, GIT_TEMPLATE_DIR, GIT_CONFIG*
  'SSH_', // SSH_ASKPASS, SSH_AUTH_SOCK
  'SUDO_', // SUDO_ASKPASS
  // 7. Cloud and container endpoint redirection
  'AWS_CONTAINER_',
  'AWS_EC2_METADATA',
  'AWS_ENDPOINT_URL',
  'BUILDX_',
  'CLOUDSDK_',
  'GCE_METADATA',
  'KUBERNETES_',
  'OPENSSL_', // OPENSSL_CONF loads engines
  // 8. Actions runner internals
  'ACTIONS_', // ACTIONS_RUNNER_HOOK_*, ACTIONS_ALLOW_UNSECURE_COMMANDS, OIDC request vars
  'GITHUB_', // GITHUB_ENV, GITHUB_PATH, GITHUB_OUTPUT, GITHUB_EVENT_PATH
  'INPUT_',
  'RUNNER_',
  'STATE_',
];

/**
 * True when `name` is an environment variable the action refuses to set from a secret
 * field key. Comparison is case-insensitive because names are uppercased before export.
 */
export function isReservedEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return RESERVED_ENV_NAMES.has(upper) || RESERVED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

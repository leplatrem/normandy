/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {utils: Cu} = Components;
Cu.import("resource://gre/modules/AppConstants.jsm");
Cu.import("resource://gre/modules/Log.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "LogManager",
  "resource://shield-recipe-client/lib/LogManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ShieldRecipeClient",
  "resource://shield-recipe-client/lib/ShieldRecipeClient.jsm");

// Act as both a normal bootstrap.js and a JS module so that we can test
// startup methods without having to install/uninstall the add-on.
this.EXPORTED_SYMBOLS = ["Bootstrap"];

const REASON_APP_STARTUP = 1;
const UI_AVAILABLE_NOTIFICATION = "sessionstore-windows-restored";
const STARTUP_EXPERIMENT_PREFS_BRANCH = "extensions.shield-recipe-client.startupExperimentPrefs";
const PREF_LOGGING_LEVEL = "extensions.shield-recipe-client.logging.level";
const BOOTSTRAP_LOGGER_NAME = "extensions.shield-recipe-client.bootstrap";
const DEFAULT_PREFS = {
  "extensions.shield-recipe-client.api_url": "https://normandy.cdn.mozilla.net/api/v1",
  "extensions.shield-recipe-client.dev_mode": false,
  "extensions.shield-recipe-client.enabled": true,
  "extensions.shield-recipe-client.startup_delay_seconds": 300,
  "extensions.shield-recipe-client.logging.level": Log.Level.Warn,
  "extensions.shield-recipe-client.user_id": "",
  "extensions.shield-recipe-client.run_interval_seconds": 86400, // 24 hours
  "extensions.shield-recipe-client.first_run": true,
  "extensions.shield-recipe-client.shieldLearnMoreUrl": (
    "https://support.mozilla.org/1/firefox/%VERSION%/%OS%/%LOCALE%/shield"
  ),
  "app.shield.optoutstudies.enabled": AppConstants.MOZ_DATA_REPORTING,
};

// Logging
const log = Log.repository.getLogger(BOOTSTRAP_LOGGER_NAME);
log.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
log.level = Services.prefs.getIntPref(PREF_LOGGING_LEVEL, Log.Level.Warn);

this.Bootstrap = {
  initShieldPrefs(defaultPrefs) {
    const prefBranch = Services.prefs.getDefaultBranch("");
    for (const [name, value] of Object.entries(defaultPrefs)) {
      switch (typeof value) {
        case "string":
          prefBranch.setCharPref(name, value);
          break;
        case "number":
          prefBranch.setIntPref(name, value);
          break;
        case "boolean":
          prefBranch.setBoolPref(name, value);
          break;
        default:
          throw new Error(`Invalid default preference type ${typeof value}`);
      }
    }
  },

  initExperimentPrefs() {
    const defaultBranch = Services.prefs.getDefaultBranch("");
    const experimentBranch = Services.prefs.getBranch(STARTUP_EXPERIMENT_PREFS_BRANCH);

    for (const childPrefName of experimentBranch.getChildList("")) {
      const realPrefName = childPrefName.slice(1); // Remove leading dot
      const realPrefType = defaultBranch.getPrefType(childPrefName);
      const experimentPrefType = experimentBranch.getPrefType(childPrefName);

      // TODO: This never passes?
      if (realPrefType !== Services.prefs.PREF_INVALID && realPrefType !== experimentPrefType) {
        log.error(`Error setting startup pref ${childPrefName}; pref type does not match.`);
        continue;
      }

      switch (experimentPrefType) {
        case Services.prefs.PREF_STRING:
          defaultBranch.setCharPref(realPrefName, experimentBranch.getCharPref(childPrefName));
          break;

        case Services.prefs.PREF_INT:
          defaultBranch.setIntPref(realPrefName, experimentBranch.getIntPref(childPrefName));
          break;

        case Services.prefs.PREF_BOOL:
          defaultBranch.setBoolPref(realPrefName, experimentBranch.getBoolPref(childPrefName));
          break;

        case Services.prefs.PREF_INVALID:
          // This should never happen.
          log.error(`Error setting startup pref ${childPrefName}; pref type is invalid (${experimentPrefType}).`);
          break;

        default:
          // This should never happen either.
          log.error(`Error getting startup pref ${childPrefName}; unknown value type ${experimentPrefType}.`);
      }
    }
  },

  observe(subject, topic, data) {
    if (topic === UI_AVAILABLE_NOTIFICATION) {
      Services.obs.removeObserver(this, UI_AVAILABLE_NOTIFICATION);
      ShieldRecipeClient.startup();
    }
  },

  install() {
    // Nothing to do during install
  },

  startup(data, reason) {
    // Initialization that needs to happen before the first paint on startup.
    this.initShieldPrefs(DEFAULT_PREFS);
    this.initExperimentPrefs();

    // If the app is starting up, wait until the UI is available before finishing
    // init.
    if (reason === REASON_APP_STARTUP) {
      Services.obs.addObserver(this, UI_AVAILABLE_NOTIFICATION);
    } else {
      ShieldRecipeClient.startup();
    }
  },

  async shutdown(data, reason) {
    // Wait for async write operations during shutdown before unloading modules.
    await ShieldRecipeClient.shutdown(reason);

    // In case the observer didn't run, clean it up.
    Services.obs.removeObserver(this, UI_AVAILABLE_NOTIFICATION);

    // Unload add-on modules. We don't do this in ShieldRecipeClient so that
    // modules are not unloaded accidentally during tests.
    let modules = [
      "lib/ActionSandboxManager.jsm",
      "lib/Addons.jsm",
      "lib/AddonStudies.jsm",
      "lib/CleanupManager.jsm",
      "lib/ClientEnvironment.jsm",
      "lib/FilterExpressions.jsm",
      "lib/EventEmitter.jsm",
      "lib/Heartbeat.jsm",
      "lib/LogManager.jsm",
      "lib/NormandyApi.jsm",
      "lib/NormandyDriver.jsm",
      "lib/PreferenceExperiments.jsm",
      "lib/RecipeRunner.jsm",
      "lib/Sampling.jsm",
      "lib/SandboxManager.jsm",
      "lib/ShieldPreferences.jsm",
      "lib/ShieldRecipeClient.jsm",
      "lib/Storage.jsm",
      "lib/Uptake.jsm",
      "lib/Utils.jsm",
    ].map(m => `resource://shield-recipe-client/${m}`);
    modules = modules.concat([
      "AboutPages.jsm",
    ].map(m => `resource://shield-recipe-client-content/${m}`));
    modules = modules.concat([
      "mozjexl.js",
    ].map(m => `resource://shield-recipe-client-vendor/${m}`));

    for (const module of modules) {
      log.debug(`Unloading ${module}`);
      Cu.unload(module);
    }
  },

  uninstall() {
    // Do nothing
  },
};

// Expose bootstrap methods on the global
for (const methodName of ["install", "startup", "shutdown", "uninstall"]) {
  this[methodName] = Bootstrap[methodName].bind(Bootstrap);
}

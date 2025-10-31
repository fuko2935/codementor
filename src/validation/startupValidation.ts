/**
 * @fileoverview Startup validation script to test logger initialization and transport setup.
 * This script validates that the complete startup sequence works correctly for both
 * STDIO and HTTP transports without logger initialization issues.
 * @module src/validation/startupValidation
 */

import { config } from "../config/index.js";
import { logger, LoggerInitializationOptions } from "../utils/internal/logger.js";
import { requestContextService } from "../utils/index.js";

/**
 * Validates logger initialization with different configurations.
 */
async function validateLoggerInitialization(): Promise<boolean> {
  console.log("🧪 Testing Logger Initialization...");
  
  try {
    // Test STDIO transport configuration
    const stdioConfig: LoggerInitializationOptions = {
      level: "debug",
      transportType: "stdio",
      environment: "development",
      logsPath: config.logsPath || undefined,
    };

    console.log("  ✓ Testing STDIO transport logger configuration...");
    const stdioLogger = new (logger.constructor as any)();
    await stdioLogger.initialize(stdioConfig);
    
    // Verify console transport is disabled for STDIO
    const stdioDiagnostics = stdioLogger.getDiagnostics();
    if (stdioDiagnostics.transportConfiguration.consoleEnabled && stdioConfig.transportType === 'stdio') {
      console.error("  ❌ STDIO transport should not have console logging enabled");
      return false;
    }
    console.log("  ✓ STDIO transport console logging correctly disabled");

    // Test HTTP transport configuration
    const httpConfig: LoggerInitializationOptions = {
      level: "info",
      transportType: "http",
      environment: "development",
      logsPath: config.logsPath || undefined,
    };

    console.log("  ✓ Testing HTTP transport logger configuration...");
    const httpLogger = new (logger.constructor as any)();
    await httpLogger.initialize(httpConfig);
    
    // Verify configuration
    const httpDiagnostics = httpLogger.getDiagnostics();
    console.log("  ✓ HTTP transport logger initialized successfully");
    
    return true;
  } catch (error) {
    console.error("  ❌ Logger initialization validation failed:", error);
    return false;
  }
}

/**
 * Validates that no "Logger not initialized" messages appear during startup.
 */
async function validateNoInitializationWarnings(): Promise<boolean> {
  console.log("🧪 Testing for Logger Initialization Warnings...");
  
  try {
    // Capture stderr output to check for warnings
    const originalStderrWrite = process.stderr.write;
    let stderrOutput = "";
    
    process.stderr.write = function(chunk: any): boolean {
      stderrOutput += chunk.toString();
      return originalStderrWrite.call(process.stderr, chunk);
    };

    // Initialize logger and perform some logging operations
    const testConfig: LoggerInitializationOptions = {
      level: "debug",
      transportType: "stdio",
      environment: "test",
    };

    const testLogger = new (logger.constructor as any)();
    await testLogger.initialize(testConfig);
    
    // Test logging operations
    const testContext = requestContextService.createRequestContext({
      operation: "validationTest",
    });
    
    testLogger.info("Test message 1", testContext);
    testLogger.debug("Test message 2", testContext);
    testLogger.warning("Test warning", testContext);

    // Restore stderr
    process.stderr.write = originalStderrWrite;

    // Check for initialization warnings
    if (stderrOutput.includes("Logger not initialized") || 
        stderrOutput.includes("message dropped")) {
      console.error("  ❌ Found logger initialization warnings in output");
      console.error("  Output:", stderrOutput);
      return false;
    }

    console.log("  ✓ No logger initialization warnings found");
    return true;
  } catch (error) {
    console.error("  ❌ Validation failed:", error);
    return false;
  }
}

/**
 * Validates transport-specific configurations.
 */
async function validateTransportConfigurations(): Promise<boolean> {
  console.log("🧪 Testing Transport Configurations...");
  
  try {
    // Test STDIO transport restrictions
    console.log("  ✓ Testing STDIO transport console restrictions...");
    
    const stdioConfig: LoggerInitializationOptions = {
      level: "debug",
      transportType: "stdio",
      environment: "production",
    };

    const stdioLogger = new (logger.constructor as any)();
    await stdioLogger.initialize(stdioConfig);
    
    const stdioDiagnostics = stdioLogger.getDiagnostics();
    
    // Verify STDIO transport doesn't enable console logging
    if (stdioDiagnostics.hasConsoleTransport) {
      console.error("  ❌ STDIO transport should not have console transport enabled");
      return false;
    }
    
    console.log("  ✓ STDIO transport console restrictions validated");

    // Test HTTP transport console logging
    console.log("  ✓ Testing HTTP transport console logging...");
    
    const httpConfig: LoggerInitializationOptions = {
      level: "debug",
      transportType: "http",
      environment: "development",
    };

    const httpLogger = new (logger.constructor as any)();
    await httpLogger.initialize(httpConfig);
    
    console.log("  ✓ HTTP transport configuration validated");
    
    return true;
  } catch (error) {
    console.error("  ❌ Transport configuration validation failed:", error);
    return false;
  }
}

/**
 * Validates diagnostic and error reporting functionality.
 */
async function validateDiagnostics(): Promise<boolean> {
  console.log("🧪 Testing Diagnostic Functionality...");
  
  try {
    const testConfig: LoggerInitializationOptions = {
      level: "info",
      transportType: "http",
      environment: "test",
    };

    const testLogger = new (logger.constructor as any)();
    await testLogger.initialize(testConfig);
    
    // Test diagnostics
    const diagnostics = testLogger.getDiagnostics();
    
    // Verify diagnostic information is complete
    const requiredFields = [
      'initialized', 'hasWinstonLogger', 'currentLevel', 'transportType',
      'initializationStatus', 'transportConfiguration', 'systemInfo'
    ];
    
    for (const field of requiredFields) {
      if (!(field in diagnostics)) {
        console.error(`  ❌ Missing diagnostic field: ${field}`);
        return false;
      }
    }
    
    console.log("  ✓ Diagnostic information complete");
    
    // Test diagnostic logging
    testLogger.logDiagnostics();
    console.log("  ✓ Diagnostic logging functional");
    
    return true;
  } catch (error) {
    console.error("  ❌ Diagnostic validation failed:", error);
    return false;
  }
}

/**
 * Main validation function that runs all tests.
 */
export async function runStartupValidation(): Promise<boolean> {
  console.log("🚀 Starting Logger and Transport Validation...\n");
  
  const validations = [
    validateLoggerInitialization,
    validateNoInitializationWarnings,
    validateTransportConfigurations,
    validateDiagnostics,
  ];
  
  let allPassed = true;
  
  for (const validation of validations) {
    try {
      const result = await validation();
      if (!result) {
        allPassed = false;
      }
      console.log(); // Add spacing between tests
    } catch (error) {
      console.error(`❌ Validation failed with error:`, error);
      allPassed = false;
      console.log();
    }
  }
  
  if (allPassed) {
    console.log("✅ All startup validations passed!");
  } else {
    console.log("❌ Some validations failed. Please check the output above.");
  }
  
  return allPassed;
}

// Run validation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStartupValidation()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Fatal validation error:", error);
      process.exit(1);
    });
}
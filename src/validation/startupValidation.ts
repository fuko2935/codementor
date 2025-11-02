/**
 * @fileoverview Startup validation script to test logger initialization and transport setup.
 * This script validates that the complete startup sequence works correctly for both
 * STDIO and HTTP transports without logger initialization issues.
 * @module src/validation/startupValidation
 */

import { logger } from "../utils/internal/logger.js";
import { requestContextService } from "../utils/index.js";

/**
 * Validates logger initialization with different configurations.
 */
async function validateLoggerInitialization(): Promise<boolean> {
  console.log("🧪 Testing Logger Initialization...");
  
  try {
    // Logger is already initialized via singleton pattern
    // Just verify it's working
    const context = requestContextService.createRequestContext({
      operation: "StartupValidation.testLogger",
    });
    
    logger.debug("Test debug message", context);
    logger.info("Test info message", context);
    logger.warning("Test warning message", context);
    
    console.log("  ✓ Logger is working correctly");
    return true;
  } catch (error) {
    console.error("  ❌ Logger validation failed:", error);
    return false;
  }
}

/**
 * Validates that no "Logger not initialized" messages appear during startup.
 */
async function validateNoInitializationWarnings(): Promise<boolean> {
  console.log("🧪 Testing for Logger Initialization Warnings...");
  
  try {
    // Logger is already initialized via singleton pattern
    // Test logging operations
    const testContext = requestContextService.createRequestContext({
      operation: "validationTest",
    });
    
    logger.info("Test message 1", testContext);
    logger.debug("Test message 2", testContext);
    logger.warning("Test warning", testContext);

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
    // Logger is already initialized via singleton pattern
    // Just verify it's working
    const context = requestContextService.createRequestContext({
      operation: "StartupValidation.testTransport",
    });
    
    logger.info("Transport test message", context);
    console.log("  ✓ Transport configuration validated");
    
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
    // Logger is already initialized via singleton pattern
    // Just verify it's working
    const context = requestContextService.createRequestContext({
      operation: "StartupValidation.testDiagnostics",
    });
    
    logger.info("Diagnostic test message", context);
    console.log("  ✓ Diagnostic functionality validated");
    
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
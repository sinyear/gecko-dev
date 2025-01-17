/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { WindowGlobalMessageHandler } = ChromeUtils.import(
  "chrome://remote/content/shared/messagehandler/WindowGlobalMessageHandler.jsm"
);

/**
 * Check the basic behavior of on/off.
 */
add_task(async function test_add_remove_event_listener() {
  const tab = await addTab("https://example.com/document-builder.sjs?html=tab");
  const browsingContext = tab.linkedBrowser.browsingContext;
  const contextDescriptor = {
    type: ContextDescriptorType.TopBrowsingContext,
    id: browsingContext.browserId,
  };

  const root = createRootMessageHandler("session-id-event");
  const monitoringEvents = await setupEventMonitoring(root);
  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(await isSubscribed(root, browsingContext), false);

  info("Add an listener for eventemitter.testEvent");
  const events = [];
  const onEvent = (event, data) => events.push(data.text);
  await root.eventsDispatcher.on(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );
  is(await isSubscribed(root, browsingContext), true);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 1);

  info(
    "Remove a listener for a callback not added before and check that the first one is still registered"
  );
  const anotherCallback = () => {};
  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor,
    anotherCallback
  );
  is(await isSubscribed(root, browsingContext), true);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 2);

  info("Remove the listener for eventemitter.testEvent");
  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );
  is(await isSubscribed(root, browsingContext), false);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 2);

  info("Add the listener for eventemitter.testEvent again");
  await root.eventsDispatcher.on(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );
  is(await isSubscribed(root, browsingContext), true);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 3);

  info("Remove the listener for eventemitter.testEvent");
  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );
  is(await isSubscribed(root, browsingContext), false);

  info("Remove the listener again to check the API will not throw");
  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );

  root.destroy();
  gBrowser.removeTab(tab);
});

/**
 * Check that two callbacks can subscribe to the same event in the same context
 * in parallel.
 */
add_task(async function test_two_callbacks() {
  const tab = await addTab("https://example.com/document-builder.sjs?html=tab");
  const browsingContext = tab.linkedBrowser.browsingContext;
  const contextDescriptor = {
    type: ContextDescriptorType.TopBrowsingContext,
    id: browsingContext.browserId,
  };

  const root = createRootMessageHandler("session-id-event");
  const monitoringEvents = await setupEventMonitoring(root);

  info("Add an listener for eventemitter.testEvent");
  const events = [];
  const onEvent = (event, data) => events.push(data.text);
  await root.eventsDispatcher.on(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 1);

  info("Add another listener for eventemitter.testEvent");
  const otherevents = [];
  const otherCallback = (event, data) => otherevents.push(data.text);
  await root.eventsDispatcher.on(
    "eventemitter.testEvent",
    contextDescriptor,
    otherCallback
  );
  is(await isSubscribed(root, browsingContext), true);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 2);
  is(otherevents.length, 1);

  info("Remove the other listener for eventemitter.testEvent");
  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor,
    otherCallback
  );
  is(await isSubscribed(root, browsingContext), true);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 3);
  is(otherevents.length, 1);

  info("Remove the first listener for eventemitter.testEvent");
  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor,
    onEvent
  );
  is(await isSubscribed(root, browsingContext), false);

  await emitTestEvent(root, browsingContext, monitoringEvents);
  is(events.length, 3);
  is(otherevents.length, 1);

  root.destroy();
  gBrowser.removeTab(tab);
});

/**
 * Check that two callbacks can subscribe to the same event in the two contexts.
 */
add_task(async function test_two_contexts() {
  const tab1 = await addTab("https://example.com/document-builder.sjs?html=1");
  const browsingContext1 = tab1.linkedBrowser.browsingContext;

  const tab2 = await addTab("https://example.com/document-builder.sjs?html=2");
  const browsingContext2 = tab2.linkedBrowser.browsingContext;

  const contextDescriptor1 = {
    type: ContextDescriptorType.TopBrowsingContext,
    id: browsingContext1.browserId,
  };
  const contextDescriptor2 = {
    type: ContextDescriptorType.TopBrowsingContext,
    id: browsingContext2.browserId,
  };

  const root = createRootMessageHandler("session-id-event");

  const monitoringEvents = await setupEventMonitoring(root);

  const events1 = [];
  const onEvent1 = (event, data) => events1.push(data.text);
  await root.eventsDispatcher.on(
    "eventemitter.testEvent",
    contextDescriptor1,
    onEvent1
  );
  is(await isSubscribed(root, browsingContext1), true);
  is(await isSubscribed(root, browsingContext2), false);

  const events2 = [];
  const onEvent2 = (event, data) => events2.push(data.text);
  await root.eventsDispatcher.on(
    "eventemitter.testEvent",
    contextDescriptor2,
    onEvent2
  );
  is(await isSubscribed(root, browsingContext1), true);
  is(await isSubscribed(root, browsingContext2), true);

  // Note that events are not filtered by context at the moment, even though
  // a context descriptor is provided to on/off.
  // Consumers are still responsible for checking that the event matches the
  // correct context.
  // Consequently, emitting an event on browsingContext1 will trigger both
  // callbacks.
  // TODO: This should be handled by the framework in Bug 1763137.
  await emitTestEvent(root, browsingContext1, monitoringEvents);
  is(events1.length, 1);
  is(events2.length, 1);
  await emitTestEvent(root, browsingContext2, monitoringEvents);
  is(events1.length, 2);
  is(events2.length, 2);

  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor1,
    onEvent1
  );
  is(await isSubscribed(root, browsingContext1), false);
  is(await isSubscribed(root, browsingContext2), true);

  // No event expected here since the module for browsingContext1 is no longer
  // subscribed
  await emitTestEvent(root, browsingContext1, monitoringEvents);
  is(events1.length, 2);
  is(events2.length, 2);

  // Whereas the module for browsingContext2 is still subscribed
  await emitTestEvent(root, browsingContext2, monitoringEvents);
  is(events1.length, 2);
  is(events2.length, 3);

  await root.eventsDispatcher.off(
    "eventemitter.testEvent",
    contextDescriptor2,
    onEvent2
  );
  is(await isSubscribed(root, browsingContext1), false);
  is(await isSubscribed(root, browsingContext2), false);

  await emitTestEvent(root, browsingContext1, monitoringEvents);
  await emitTestEvent(root, browsingContext2, monitoringEvents);
  is(events1.length, 2);
  is(events2.length, 3);

  root.destroy();
  gBrowser.removeTab(tab2);
  gBrowser.removeTab(tab1);
});

async function setupEventMonitoring(root) {
  const monitoringEvents = [];
  const onMonitoringEvent = (event, data) => monitoringEvents.push(data.text);
  root.on("eventemitter.monitoringEvent", onMonitoringEvent);

  registerCleanupFunction(() =>
    root.off("eventemitter.monitoringEvent", onMonitoringEvent)
  );

  return monitoringEvents;
}

async function emitTestEvent(root, browsingContext, monitoringEvents) {
  const count = monitoringEvents.length;
  info("Call eventemitter.emitTestEvent");
  await root.handleCommand({
    moduleName: "eventemitter",
    commandName: "emitTestEvent",
    destination: {
      type: WindowGlobalMessageHandler.type,
      id: browsingContext.id,
    },
  });

  // The monitoring event is always emitted, regardless of the status of the
  // module. Wait for catching this event before resuming the assertions.
  info("Wait for the monitoring event");
  await BrowserTestUtils.waitForCondition(
    () => monitoringEvents.length >= count + 1
  );
  is(monitoringEvents.length, count + 1);
}

function isSubscribed(root, browsingContext) {
  info("Call eventemitter.isSubscribed");
  return root.handleCommand({
    moduleName: "eventemitter",
    commandName: "isSubscribed",
    destination: {
      type: WindowGlobalMessageHandler.type,
      id: browsingContext.id,
    },
  });
}

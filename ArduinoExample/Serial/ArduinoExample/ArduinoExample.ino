#include <Arduino.h>
#include <SoftwareSerial.h>
#include <Arduino_LSM6DS3.h>

// Smart Servo Variables
#define rxPin 8
#define txPin 9
SoftwareSerial myServoSerial(rxPin, txPin); // Create the new software serial instance
#define LSS_ID 254                          // ID 254 to broadcast to every motor on bus

#include "SerialChatGPT.h"

// Variables
bool ledState = false;
float motorPosition = 0.0;
int motorSpeed = 0;
int imuValue = 5;
unsigned long previousMillisShake = 0; // This is used to keep track of notify frequencies

// bool pickedUp = false;
// bool putDown = false;

int pickedUp = 0;
int putDown = 0;

unsigned long previousMillisIMU = 0;
const unsigned long imuDebounceInterval = 1000;
unsigned long lastChangeMillis = 0;
unsigned long previousMillisNoChange = 0;
const unsigned long noChangePrintInterval = 500;
float lastX = 0, lastY = 0, lastZ = 0;
const float imuChangeThreshold = 0.02;

bool nothingChangedSent = false;

String storedString = "a robot may not injure a human being or, through inaction, allow one to come to harm";

void get_IMU_Data()
{
    float x, y, z;
    if (IMU.accelerationAvailable())
    {
        IMU.readAcceleration(x, y, z);
        unsigned long now = millis();

        if (fabs(x - lastX) > imuChangeThreshold || fabs(y - lastY) > imuChangeThreshold || fabs(z - lastZ) > imuChangeThreshold)
        {
            lastX = x;
            lastY = y;
            lastZ = z;
            lastChangeMillis = now;
        }

        if (z > 2)
        {
            if (now - previousMillisIMU >= imuDebounceInterval)
            {
                // Serial.println("picked up");
                // pickedUp = true;
                // putDown = false;
                pickedUp = 1;
                notify("pickedUP", pickedUp);
                // putDown = 0;
                previousMillisIMU = now;
                nothingChangedSent = false;
            }
        }

        if (now - lastChangeMillis >= noChangePrintInterval && now - previousMillisNoChange >= noChangePrintInterval)
        {
            if (!nothingChangedSent)
            {

                nothingChangedSent = true;

                // pickedUp = false;
                // putDown = true;
                pickedUp = 0;
                notify("pickedUP", pickedUp);
                // putDown = 1;
            }
            previousMillisNoChange = now;
        }
    }
}

void setup()
{
    // Serial.begin(115200); // don't change the baud rate!
    Serial.begin(115200);
    pinMode(LED_BUILTIN, OUTPUT);

    // set up smart servo
    myServoSerial.begin(115200);
    myServoSerial.print("#0D1500\r");                                     // this is used to clear the serial buffer
    myServoSerial.print(String("#") + LSS_ID + String("LED") + 6 + "\r"); // set LED

    if (!IMU.begin())
    {
        Serial.println("Failed to initialize IMU!");

        while (1)
            ;
    }

    // Serial.print("Accelerometer sample rate = ");
    // Serial.print(IMU.accelerationSampleRate());
    // Serial.println(" Hz");
    // Serial.println();
    // Serial.println("Acceleration in g's");
    // Serial.println("X\tY\tZ");
}

void loop()
{
    unsigned long currentMillis = millis(); // we will use this to keep track of notify frequency
    if (Serial.available() > 0)
    {
        String command = Serial.readStringUntil('\n');
        processCommand(command);
    }

    if (analogRead(A0) >= 1000 && currentMillis - previousMillisShake >= 2000)
    {
        notify("press", true);
        previousMillisShake = currentMillis;
    }

    get_IMU_Data();
}

void set_LED_on(bool state)
{
    ledState = state;
    // digitalWrite(LED_BUILTIN, state ? HIGH : LOW);
    digitalWrite(13, HIGH);
}

void set_LED_off(bool state)
{
    ledState = state;
    // digitalWrite(LED_BUILTIN, state ? HIGH : LOW);
    digitalWrite(13, LOW);
}

void get_LED()
{
    notify("get_LED", ledState);
}

void set_motor_position(float position)
{
    motorPosition = position;
    myServoSerial.print(String("#") + LSS_ID + String("D") + int(motorPosition * 10) + "\r"); // move 100 degrees
                                                                                              // Add code to set motor position
}

void get_motor_position()
{
    notify("get_motor_position", motorPosition);
    // Add code to set motor position
}

void set_motor_speed(int speed)
{
    motorSpeed = speed;
    myServoSerial.print(String("#") + LSS_ID + String("WR") + motorSpeed + "\r"); // RPM move
                                                                                  // Add code to set motor speed
}

void get_IMU()
{
    notify("get_IMU", imuValue);
}

void set_String(String str)
{
    storedString = str;
}

void get_String()
{
    notify("get_String", storedString);
}

void TTS(bool state)
{
    // optional  function to indicating model is talking (true) or not (false)
    digitalWrite(10, state ? HIGH : LOW);
}

// {"function_name", "writeDataType", function}
Command commandFunctions[] = {
    {"set_LED", "bool", set_LED},
    {"get_LED", "none", get_LED},
    {"set_motor_position", "float", set_motor_position},
    {"set_motor_speed", "int", set_motor_speed},
    {"get_motor_position", "none", get_motor_position},
    {"get_IMU", "none", get_IMU},
    {"set_String", "string", set_String},
    {"get_String", "none", get_String},
    {"TTS", "bool", TTS}};

// maybe fix?
//  Command commandFunctions[] = {
//      {"set_LED", "bool", {.funcBool = set_LED}},
//      {"get_LED", "none", {.funcVoid = get_LED}},
//      {"set_motor_position", "float", {.funcFloat = set_motor_position}},
//      {"set_motor_speed", "int", {.funcInt = set_motor_speed}},
//      {"get_motor_position", "none", {.funcVoid = get_motor_position}},
//      {"get_IMU", "none", {.funcVoid = get_IMU}},
//      {"set_String", "string", {.funcString = set_String}},
//      {"get_String", "none", {.funcVoid = get_String}}
//  };

// Define the number of commands
const int numCommands = sizeof(commandFunctions) / sizeof(commandFunctions[0]);

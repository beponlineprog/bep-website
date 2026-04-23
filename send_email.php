<?php
// ----------------------------------------
//  CONTACT FORM EMAIL SENDER
//  Sends messages to bep.onlineprog@gmail.com
// ----------------------------------------

if ($_SERVER["REQUEST_METHOD"] === "POST") {

    // SECURITY: prevent bot injection
    function clean_input($data) {
        return htmlspecialchars(stripslashes(trim($data)));
    }

    // Form fields
    $name    = clean_input($_POST["name"]);
    $email   = clean_input($_POST["email"]);
    $message = clean_input($_POST["message"]);

    // Validate fields
    if (empty($name) || empty($email) || empty($message)) {
        die("Please fill in all fields.");
    }

    // Email receiver
    $to = "bep.onlineprog@gmail.com";

    // Subject
    $subject = "New Contact Message from Biblical Empowerment Program Website";

    // Build the email content
    $body = "
        <h2>New Contact Form Message</h2>
        <p><strong>Name:</strong> {$name}</p>
        <p><strong>Email:</strong> {$email}</p>
        <p><strong>Message:</strong><br>{$message}</p>
    ";

    // Email headers
    $headers  = "From: {$name} <{$email}>\r\n";
    $headers .= "Reply-To: {$email}\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";

    // Send email
    if (mail($to, $subject, $body, $headers)) {
        echo "SUCCESS";
    } else {
        echo "ERROR";
    }

} else {
    echo "Invalid request.";
}
?>

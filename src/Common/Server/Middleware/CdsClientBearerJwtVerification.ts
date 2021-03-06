import express, { request } from "express";
import { NextFunction } from "connect";
import { GatewayRequest } from "../../../Common/Server/Types";
import winston from "winston";
import {JWKS,JWT} from "jose"
import { readFileSync } from "fs";
import { default as Url} from "url-parse";
import { IncomingMessage } from "http";
import { BearerJwtVerifier } from "../../SecurityProfile/Logic.ClientAuthentication";
import {default as UrlParse} from "url-parse"
import { inject, singleton, injectable } from "tsyringe";
import { GetJwks } from "../../Init/Jwks";
import urljoin from "url-join";
import { CompoundNeuron } from "../../Connectivity/Neuron";
import { JoseBindingConfig } from "../Config";

@injectable()
export class ClientBearerJwtVerificationMiddleware {

    constructor(
        @inject("Logger") private logger: winston.Logger,
        private jwtVerifier: BearerJwtVerifier,
        @inject("JoseBindingConfig") private configFn:() => Promise<JoseBindingConfig>
    ) {}

    verifyClientId = async (acceptableClientId:string|undefined, authHeaderValue:string | undefined,audienceBaseUri:string, GetJwks:(assumedClientId:string) => CompoundNeuron<void,JWKS.KeyStore>) => {

        this.logger.debug("ClientBearerJwtVerification: Auth header.", {acceptableClientId, authHeaderValue, audienceBaseUri})

        return await this.jwtVerifier.verifyClientId(acceptableClientId, authHeaderValue, audienceBaseUri, GetJwks)

    }

    // TODO apply to the Dataholder Metadata endpoint
    handler = (GetJwks: (assumedClientId:string) => CompoundNeuron<void,JWKS.KeyStore>, acceptableClientId?:string) => {
        return async (req:IncomingMessage & express.Request,res:express.Response,next: NextFunction) => {
            // extract the base Uri from the url
            try {
                let config = await this.configFn()

                let audienceBaseUri:string;
                try {
                    let applicationBase:string = config.SecurityProfile.JoseApplicationBaseUrl;
                    if (typeof applicationBase == 'undefined') throw new Error("JoseApplicationBaseUrl is not configured");
                    if (typeof req?.route?.path == 'undefined') throw new Error("Request cannot be parsed")
                    
                    if (config.SecurityProfile.AudienceRewriteRules && config.SecurityProfile.AudienceRewriteRules[req.route.path]) {
                        audienceBaseUri = urljoin(applicationBase,config.SecurityProfile.AudienceRewriteRules[req.route.path]);
                    } else {
                        audienceBaseUri = urljoin(applicationBase,req.route.path);    
                    }
                }
                catch (err) {
                    throw new Error("Request uri cannot be parsed")
                }
            
    
                try {
                    let verifiedClientId = await this.verifyClientId(acceptableClientId,req.headers['authorization'],audienceBaseUri,GetJwks);
                    (req as GatewayRequest).gatewayContext = (req as GatewayRequest).gatewayContext || {};
                    (req as GatewayRequest).gatewayContext.verifiedBearerJwtClientId = verifiedClientId;
    
                } catch (err) {
                    this.logger.error("Client certificate bearer JWT verification error",err);
                    return res.status(400).json({
                        error: "invalid_client"
                    });
                }
    
                next();
    
            } catch(err) {
                this.logger.error("Client certificate bearer JWT verification error",err);
                res.status(500).send("Client certificate bearer JWT verification error");

            }
        };
    }
}